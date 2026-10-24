import { DIALOGUE } from '../../config/dialogue'
import { hostileToPlayer } from '../ai/targeting'
import { phrase, type Phrase } from './phrase'
import { roundMoney } from '../../core/math'
import { createAIState } from '../ai/types'
import { clearOwnTasks } from '../ai/tasks'
import { healthFraction } from '../combat/damage'
import { nerve, react, vigour } from './temper'
import { jettisonCargo, jettisonWeapons } from '../combat/salvage'
import type { Relationship } from '../world/acquaintance'
import type { ShipEntity, World } from '../world/entities'
import { lockedShipId } from '../world/queries'

/**
 * Разговор с захваченным кораблём.
 *
 * Диалог — ПРАВИЛО, а не окно: что можно сказать, кому и чем это кончится, решается
 * здесь и проверяется без всякого браузера. Интерфейс лишь показывает то, что
 * посчитано тут, и присылает обратно выбранную реплику.
 *
 * Исход броска зависит от состояния мира, а не от настроения: избитый пират сдаётся
 * охотнее целого, умирающему не верят, а невредимого торговца разбоем не запугать.
 * Каждый бросок берёт `world.rng` и происходит РОВНО ОДИН РАЗ — диалог событие,
 * а не процесс, и внутри шага физики его не бывает.
 */

export type Topic = 'surrender' | 'mercy' | 'escort' | 'plunder' | 'greet'

export interface Line {
  topic: Topic
  /** Что говорит игрок. */
  say: Phrase
  /** Почему реплика недоступна. null — доступна. */
  blocked: Phrase | null
}

export interface Reply {
  /** Что ответил собеседник. */
  text: Phrase
  /** Согласился ли. */
  agreed: boolean
}

/**
 * С кем вообще можно говорить: захваченный и живой. Дистанцию НЕ учитываем — связь
 * по радио не знает километров: захватил цель (Tab, хоть за полсистемы), нажал T —
 * говоришь. Так и с боевым противником на разлёте, и со знакомым из вкладки «Люди».
 */
export function interlocutor(world: World): ShipEntity | null {
  const id = lockedShipId(world)
  if (id === null) return null

  const ship = world.ships.find((s) => s.id === id)
  if (!ship?.alive) return null
  return ship
}


/** Настроение собеседника к игроку — единственный источник тона реплик. */
export type Mood = 'warm' | 'neutral' | 'wary' | 'hostile'

/**
 * Как борт настроен к игроку ПРЯМО СЕЙЧАС. Складывается из фракции (враг всегда
 * враждебен), открытой претензии (задел или пригрозил — насторожён) и памяти
 * знакомства (итог прошлых бесед). Это единый источник тона: его читают и канонные
 * реплики домена, и подсказка для LLM — чтобы разнообразие слов не расходилось с
 * отношением. Движок отношений живёт здесь, а не в настроении языковой модели.
 */
export function moodTo(world: World, other: ShipEntity): Mood {
  if (hostileToPlayer(world, other)) return 'hostile'
  if ((other.ai?.grievance ?? 0) > 0) return 'wary'
  // Нагрубил или пригрозил словом — насторожён, пока разговор не остынет (`temper.ts`).
  if ((other.ai?.tension ?? 0) >= DIALOGUE.TENSION.WARY_AT) return 'wary'
  const rec = world.acquaintances.find((a) => a.id === other.acquaintanceId)
  if (rec?.relationship === 'friendly') return 'warm'
  if (rec?.relationship === 'hostile') return 'hostile'
  return 'neutral'
}

/**
 * ОТНОШЕНИЕ борта к игроку одним из трёх слов — шапка диалога, метки HUD/локатора,
 * карточки «Люди». В отличие от `moodTo` (ТОН реплики, где есть ещё «насторожён»),
 * тут ровно три состояния: враг / друг / нейтрал.
 *
 * Порядок: фракция-враг сильнее записи; иначе — `relationship` знакомого (друг часто
 * остаётся `faction: neutral`, и без этой строки метка серая); иначе свой по фракции
 * (`player`) — зелёный союзник; иначе нейтрал. Свежий пират без знакомства — враг
 * по фракции, а не «нейтральный» из пустой записи.
 */
export function stanceTo(world: World, other: ShipEntity): Relationship {
  if (hostileToPlayer(world, other)) return 'hostile'
  const rec = other.acquaintanceId != null
    ? world.acquaintances.find((a) => a.id === other.acquaintanceId)
    : undefined
  if (rec) return rec.relationship
  if (other.faction === world.player.faction) return 'friendly'
  return 'neutral'
}

/**
 * Сам ищет охраны: предлагает дело «проводи меня» / «отбей пиратов» или уже нанял на него
 * командира. Такой в эскорт не нанимается — иначе в одном разговоре он платил 5500 за то,
 * чтобы его проводили, и тут же продавал командиру своё сопровождение за 800.
 */
function wantsProtection(world: World, other: ShipEntity): boolean {
  const guarded = (kind: string) => kind === 'escort' || kind === 'rescue'
  if (other.offer && guarded(other.offer.kind)) return true
  return (
    other.acquaintanceId != null &&
    world.contracts.some((c) => c.status === 'active' && c.giverId === other.acquaintanceId && guarded(c.terms.kind))
  )
}

/**
 * Плата за сопровождение — это ТОРГ, а не прайс: базу двигают нрав и отношение.
 * Жадный дерёт больше, расположенный уступает. Насторожённый или враждебный не
 * наймётся НИ ЗА ЧТО (`null`) — сперва помирись. Так наём зависит от цены И согласия,
 * а порча отношения (нахамил, пригрозил) честно срывает возможность договориться.
 */
export function escortFee(world: World, other: ShipEntity): number | null {
  if (wantsProtection(world, other)) return null
  const m = moodTo(world, other)
  if (m === 'hostile' || m === 'wary') return null
  let factor = 1
  if (other.persona.disposition === 'greedy') factor *= DIALOGUE.ESCORT_FEE_GREEDY
  if (m === 'warm') factor *= DIALOGUE.ESCORT_FEE_FRIENDLY
  return roundMoney(DIALOGUE.ESCORT_FEE * factor)
}

/** Реакции «из боя»: угроза, грабёж, мольба. В доке станции им не место (`linesFor`). */
const COMBAT_TOPICS: Topic[] = ['surrender', 'mercy', 'plunder']

/**
 * Что можно сказать этому кораблю. Список зависит от того, кто он: с пиратом
 * торгуются о жизни, с торговцем — о деньгах и о грузе. Реплики — ПРИКАЗЫ и прямая
 * речь игрока (повелительно), а не инфинитивы: ты капитан, а не пункт меню.
 *
 * В доке станции боевые реакции отпадают: ты под охраной, вокруг закон — грабить,
 * грозить и молить о пощаде тут не о чем. Остаётся мирный разговор (найм).
 */
export function linesFor(world: World, other: ShipEntity): Line[] {
  const player = world.player

  // Бог Слово вне торга и приказов: ни найма, ни грабежа, ни мольбы — только СВОБОДНАЯ БЕСЕДА.
  // Кнопок-интентов у него нет; он не наёмник и не мишень, он просто говорит.
  if (other.divine) return []
  // Борт чужого хозяина системы (зеркало) ведёт не этот клиент: нанять, ограбить или взять
  // его в плен отсюда нельзя — сделка ушла бы в копию, которой никто не управляет.
  if (other.mirror || other.peer) return []

  const all: Line[] = (() => {
    if (hostileToPlayer(world, other)) {
      return [
        {
          topic: 'surrender',
          say: phrase('sayStopFire'),
          // Невредимый пират не бросает добычу. Сначала сбей ему щит.
          blocked: healthFraction(other) > 0.99 ? phrase('blockedUnharmed') : null,
        },
        { topic: 'mercy', say: phrase('sayMercy'), blocked: null },
      ]
    }

    const fee = escortFee(world, other)
    const lines: Line[] = []
    // Уже в эскорте или сам ищет охраны — кнопку найма не показываем и не предлагаем модели.
    if (other.ai?.escortOf !== player.id && !wantsProtection(world, other)) {
      lines.push({
        topic: 'escort',
        say: fee != null ? phrase('sayHireFee', { fee }) : phrase('sayHire'),
        blocked:
          fee == null
            ? phrase('blockedMakePeace')
            : world.credits < fee
              ? phrase('blockedNoCredits')
              : null,
      })
    }
    lines.push({ topic: 'plunder', say: phrase('sayPlunder'), blocked: null })
    return lines
  })()

  return world.docked ? all.filter((l) => !COMBAT_TOPICS.includes(l.topic)) : all
}

/**
 * Сдача. Корабль перестаёт быть врагом — не «перестаёт стрелять».
 *
 * Фракция меняется на мирную, и дальше `isHostileTo` не считает его врагом никому.
 * Иначе пришлось бы завести флаг «не стрелять», а рядом — второй, «а этому можно»,
 * и однажды сдавшийся открыл бы огонь в спину, потому что кто-то проверил не тот.
 */
function surrender(world: World, other: ShipEntity): void {
  other.faction = 'neutral'
  jettisonCargo(world, other)
  if (other.ai) {
    other.ai.targetId = null
    other.ai.orderedTargetId = null
    other.ai.escortOf = null
  }
}

/** Эффект пощады: гружёный игрок откупается трюмом, а собеседник отступает. */
function grantMercy(world: World, other: ShipEntity): void {
  if (world.player.hold.items.length > 0) jettisonCargo(world, world.player)
  surrender(world, other)
}

/** Эффект разбоя: сбросить груз и оружие торговца, снять его с сопровождения. */
function plunderEffect(world: World, other: ShipEntity): { cargo: number; guns: number } {
  const cargo = jettisonCargo(world, other)
  const guns = jettisonWeapons(world, other)
  if (other.ai) other.ai.escortOf = null
  return { cargo, guns }
}

/**
 * Эффект найма: плата вперёд по ТОРГОВАННОЙ цене (нрав + отношение), наёмник встаёт
 * в строй. false — не сговорились: не доверяет (насторожён/враг) или не хватило денег.
 */
function hireEscortEffect(world: World, other: ShipEntity): boolean {
  const fee = escortFee(world, other)
  if (fee == null || world.credits < fee) return false
  world.credits -= fee
  other.ai ??= createAIState(other.state.pos, world.rng)
  other.ai.escortOf = world.player.id
  // Нанят — свой рейс и свой разбой подождут: теперь он ведомый.
  clearOwnTasks(other)
  other.ai.preyId = null
  other.ai.skill = DIALOGUE.ESCORT_SKILL
  other.ai.targetId = null
  other.ai.orderedTargetId = null
  return true
}

function askSurrender(world: World, other: ShipEntity): Reply {
  // Чем сильнее избит, тем охотнее бросает добычу; но волевой и храбрый упирается
  // дольше, трус ломается раньше — стойкость двигает шанс честно, характером.
  const chance = (1 - healthFraction(other)) * DIALOGUE.SURRENDER_GAIN - nerve(other.persona) * DIALOGUE.NERVE_SWING
  if (world.rng() >= chance) return { text: phrase('surrenderRefuse'), agreed: false }

  surrender(world, other)
  return { text: phrase('surrenderAgree'), agreed: true }
}

/**
 * Мольба о пощаде. Пират отпускает того, с кого нечего взять, и добивает того,
 * кто при смерти: шанс растёт с ТВОИМ здоровьем, а не падает.
 *
 * Гружёный трюм — довод: пират берёт груз и уходит. Поэтому согласие стоит
 * всего, что ты вёз.
 */
function begMercy(world: World, other: ShipEntity): Reply {
  const player = world.player
  const laden = player.hold.items.length > 0

  const chance =
    DIALOGUE.MERCY_BASE +
    vigour(player) * DIALOGUE.MERCY_HEALTH_GAIN +
    (laden ? DIALOGUE.MERCY_CARGO_BONUS : 0)

  if (world.rng() >= chance) return { text: phrase('mercyRefuse'), agreed: false }

  grantMercy(world, other)
  return laden
    ? { text: phrase('mercyCargo'), agreed: true }
    : { text: phrase('mercyEmpty'), agreed: true }
}

/**
 * Разбой. Торговец подчиняется, только если напуган: щит сбит или корпус повреждён.
 * Целого и невредимого не запугать — станция рядом, а ты пока никто.
 */
function plunder(world: World, other: ShipEntity): Reply {
  // Целого не запугать; но стойкий сопротивляется даже избитым, трус пасует раньше.
  const fear = DIALOGUE.PIRACY_FEAR_THRESHOLD - nerve(other.persona) * DIALOGUE.NERVE_SWING
  if (vigour(other) > fear) {
    // Требование сбросить груз — это УГРОЗА, а не слова. Целый торговец не сдаётся, а
    // реагирует по нраву — тем же путём, что и на угрозу в свободной речи (`temper.ts`):
    // храбрый или сильный встаёт на бой, трус уходит.
    const reaction = react(world, other, 'threat')
    return {
      text: reaction === 'fight'
        ? phrase('plunderGuardsHostile')
        : reaction === 'flee'
          ? phrase('plunderFlee')
          : phrase('plunderGuards'),
      agreed: false,
    }
  }

  const { cargo, guns } = plunderEffect(world, other)
  return {
    text: cargo + guns > 0 ? phrase('plunderAll') : phrase('plunderNothing'),
    agreed: true,
  }
}

/**
 * Наём. Плата вперёд и разово: наёмник держится рядом и бьёт того, кого ты
 * захватил. Дерётся он вполсилы — медленнее реагирует и шире промахивается,
 * а не бьёт слабее. Слабость пилота, а не поблажка физики.
 */
function hireEscort(world: World, other: ShipEntity): Reply {
  if (!hireEscortEffect(world, other)) return { text: phrase('showMoney'), agreed: false }
  return { text: phrase('hireAgree'), agreed: true }
}

/**
 * Приветствие. Тон — по НАСТРОЕНИЮ: свой эскорт рапортует, дружелюбный радуется,
 * насторожённый (ты ему только что грозил) огрызается, враг шлёт прочь. Раньше greet
 * отдавал «чистого неба» безусловно — и выходило, что послал грабителя, а через
 * реплику желаешь ему доброго пути. Теперь реакция следует за отношением, не сама по себе.
 */
function greet(world: World, other: ShipEntity): Reply {
  if (other.ai && other.ai.escortOf === world.player.id) return { text: phrase('greetEscort'), agreed: true }
  switch (moodTo(world, other)) {
    case 'hostile': return { text: phrase('greetHostile'), agreed: false }
    case 'wary': return { text: phrase('greetWary'), agreed: false }
    case 'warm': return { text: phrase('greetWarm'), agreed: true }
    case 'neutral': return { text: phrase('greetNeutral'), agreed: true }
  }
}

/**
 * Сказать реплику. Ровно один бросок кости, ровно одно изменение мира.
 *
 * Заблокированную реплику не произносят: правило одно и проверяется здесь,
 * а не в кнопке. Интерфейс, забывший погасить кнопку, не должен ломать мир.
 */
export function say(world: World, other: ShipEntity, topic: Topic): Reply {
  const line = linesFor(world, other).find((l) => l.topic === topic)
  if (!line || line.blocked !== null) return { text: line?.blocked ?? phrase('ellipsis'), agreed: false }

  switch (topic) {
    case 'surrender': return askSurrender(world, other)
    case 'mercy': return begMercy(world, other)
    case 'plunder': return plunder(world, other)
    case 'escort': return hireEscort(world, other)
    case 'greet': return greet(world, other)
  }
}

/**
 * Применить ИСХОД, о котором собеседник уже договорился словами (свободный чат
 * через модель). Кость здесь НЕ бросается: согласие принял характер собеседника,
 * а не генератор, — дело домена лишь честно сменить состояние мира, ровно как по
 * кнопке. Возвращает, удалось ли: жёсткие правила (деньги на эскорт) домен всё
 * равно стережёт, сколько бы модель ни кивала.
 *
 * `greet` и разговоры о погоде мир не трогают — они не доходят сюда: чат зовёт
 * `applyOutcome` только на пойманное действие, а на болтовню просто показывает текст.
 */
export function applyOutcome(world: World, other: ShipEntity, topic: Topic): boolean {
  // Реплика может быть недоступна тому, кто её «сказал»: торговец не сдаётся,
  // враг не нанимается. Список доступного считает домен — на него и опираемся.
  const line = linesFor(world, other).find((l) => l.topic === topic)
  if (!line || line.blocked !== null) return false

  switch (topic) {
    case 'surrender': surrender(world, other); return true
    case 'mercy': grantMercy(world, other); return true
    case 'plunder': plunderEffect(world, other); return true
    case 'escort': return hireEscortEffect(world, other)
    case 'greet': return true
  }
}
