import { DIALOGUE } from '../../config/dialogue'
import { clamp } from '../../core/math'
import { createAIState } from '../ai/types'
import { healthFraction, shieldFraction } from '../combat/damage'
import { defuseGrievance, provoke } from '../combat/grievance'
import { jettisonCargo, jettisonWeapons } from '../combat/salvage'
import type { Relationship } from '../world/acquaintance'
import type { ShipEntity, World } from '../world/entities'
import type { Persona } from '../world/persona'

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
  say: string
  /** Почему реплика недоступна. null — доступна. */
  blocked: string | null
}

export interface Reply {
  /** Что ответил собеседник. */
  text: string
  /** Согласился ли. */
  agreed: boolean
}

/**
 * С кем вообще можно говорить: захваченный и живой. Дистанцию НЕ учитываем — связь
 * по радио не знает километров: захватил цель (Tab, хоть за полсистемы), нажал T —
 * говоришь. Так и с боевым противником на разлёте, и со знакомым из вкладки «Люди».
 */
export function interlocutor(world: World): ShipEntity | null {
  const id = world.lockedTargetId
  if (id === null) return null

  const ship = world.ships.find((s) => s.id === id)
  if (!ship?.alive) return null
  return ship
}

/** Полное здоровье: щит и корпус вместе. Именно его и видит собеседник. */
const vigour = (e: ShipEntity) => (shieldFraction(e) + healthFraction(e)) / 2

/**
 * Стойкость собеседника −1..+1: насколько он НЕ склонен сломаться. Волевой и
 * храбрый держится (плюс), трус и слабовольный подаётся (минус). Двигает шансы
 * сдачи и сопротивления грабежу — честно характером, а не заниженным здоровьем.
 */
function nerve(p: Persona): number {
  const will = (p.willpower - 3) / 2 // 1..5 → −1..+1
  const grit = p.disposition === 'brave' ? 0.5 : p.disposition === 'cowardly' ? -0.5 : 0
  return clamp(will + grit, -1, 1)
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
  if (other.faction === 'hostile') return 'hostile'
  if ((other.ai?.grievance ?? 0) > 0) return 'wary'
  const rec = world.acquaintances.find((a) => a.id === other.acquaintanceId)
  if (rec?.relationship === 'friendly') return 'warm'
  if (rec?.relationship === 'hostile') return 'hostile'
  return 'neutral'
}

/**
 * ОТНОШЕНИЕ борта к игроку одним из трёх слов — то, что показывает шапка диалога.
 * В отличие от `moodTo` (это ТОН реплики, где есть ещё «насторожён»), тут ровно три
 * состояния репутации: враг всегда враждебен, иначе — итог знакомства (дружелюбен или
 * нейтрален). Свежий пират, с кем ещё не виделись, — всё равно ВРАЖДЕБНЫЙ по фракции,
 * а не «нейтральный» из пустой записи знакомства.
 */
export function stanceTo(world: World, other: ShipEntity): Relationship {
  if (other.faction === 'hostile') return 'hostile'
  const rec = world.acquaintances.find((a) => a.id === other.acquaintanceId)
  return rec?.relationship ?? 'neutral'
}

/** Соц-жест игрока в свободной речи: то, что домен из текста не вычленит сам. */
export type Social = 'insult' | 'flatter'

/**
 * Соц-реакция. Тон реплики (нахамил / польстил) РАСПОЗНАЁТ модель и шлёт триггером —
 * а СЛЕДСТВИЕ считает движок, детерминированно, в данных:
 *
 * - `insult` копит претензию как угроза (`provoke`): нейтрала может перелить во враги,
 *   и тогда `applyStance` сам рвёт эскорт и договорённости. Оскорбление имеет цену.
 * - `flatter` гасит претензию (`defuseGrievance`) — лесть успокаивает насторожённого.
 *   Но дружбы даром не даёт: расположить к себе можно ДЕЛОМ (эскорт, пощада), не словом,
 *   иначе целого пирата уболтали бы в друзья в обход честной сдачи.
 */
export function applySocial(world: World, other: ShipEntity, social: Social): void {
  if (social === 'insult') provoke(world, other, DIALOGUE.INSULT_WEIGHT)
  else defuseGrievance(other)
}

/**
 * Плата за сопровождение — это ТОРГ, а не прайс: базу двигают нрав и отношение.
 * Жадный дерёт больше, расположенный уступает. Насторожённый или враждебный не
 * наймётся НИ ЗА ЧТО (`null`) — сперва помирись. Так наём зависит от цены И согласия,
 * а порча отношения (нахамил, пригрозил) честно срывает возможность договориться.
 */
export function escortFee(world: World, other: ShipEntity): number | null {
  const m = moodTo(world, other)
  if (m === 'hostile' || m === 'wary') return null
  let factor = 1
  if (other.persona.disposition === 'greedy') factor *= DIALOGUE.ESCORT_FEE_GREEDY
  if (m === 'warm') factor *= DIALOGUE.ESCORT_FEE_FRIENDLY
  return Math.round(DIALOGUE.ESCORT_FEE * factor)
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

  const all: Line[] = (() => {
    if (other.faction === 'hostile') {
      return [
        {
          topic: 'surrender',
          say: 'ПРЕКРАТИ ОГОНЬ, СБРОСЬ ГРУЗ',
          // Невредимый пират не бросает добычу. Сначала сбей ему щит.
          blocked: healthFraction(other) > 0.99 ? 'ОН НЕВРЕДИМ И НЕ СТАНЕТ СЛУШАТЬ' : null,
        },
        { topic: 'mercy', say: 'ПОЩАДИ, НЕ СТРЕЛЯЙ', blocked: null },
      ]
    }

    const fee = escortFee(world, other)
    const lines: Line[] = []
    // Уже в эскорте — кнопку найма не показываем и не предлагаем модели.
    if (other.ai?.escortOf !== player.id) {
      lines.push({
        topic: 'escort',
        say: fee != null ? `НАНИМАЙСЯ КО МНЕ · ${fee} КР` : 'НАНИМАЙСЯ КО МНЕ',
        blocked:
          fee == null
            ? 'НЕ ПОЙДЁТ С ТОБОЙ — СНАЧАЛА ПОМИРИСЬ'
            : world.credits < fee
              ? 'НЕ ХВАТАЕТ КРЕДИТОВ'
              : null,
      })
    }
    lines.push({ topic: 'plunder', say: 'СБРОСЬ ГРУЗ И ОРУЖИЕ', blocked: null })
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
  other.ai.skill = DIALOGUE.ESCORT_SKILL
  other.ai.targetId = null
  other.ai.orderedTargetId = null
  return true
}

function askSurrender(world: World, other: ShipEntity): Reply {
  // Чем сильнее избит, тем охотнее бросает добычу; но волевой и храбрый упирается
  // дольше, трус ломается раньше — стойкость двигает шанс честно, характером.
  const chance = (1 - healthFraction(other)) * DIALOGUE.SURRENDER_GAIN - nerve(other.persona) * DIALOGUE.NERVE_SWING
  if (world.rng() >= chance) return { text: 'СНАЧАЛА ПОПРОБУЙ МЕНЯ ВЗЯТЬ.', agreed: false }

  surrender(world, other)
  return { text: 'НЕ СТРЕЛЯЙ! ГРУЗ ТВОЙ, ТОЛЬКО ОТПУСТИ.', agreed: true }
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

  if (world.rng() >= chance) return { text: 'ПОЗДНО. ТЫ УЖЕ МЁРТВ.', agreed: false }

  grantMercy(world, other)
  return laden
    ? { text: 'ГРУЗ ЗА БОРТ — И ЛЕТИ. МНЕ ХВАТИТ.', agreed: true }
    : { text: 'С ТЕБЯ И ВЗЯТЬ НЕЧЕГО. УБИРАЙСЯ.', agreed: true }
}

/**
 * Разбой. Торговец подчиняется, только если напуган: щит сбит или корпус повреждён.
 * Целого и невредимого не запугать — станция рядом, а ты пока никто.
 */
function plunder(world: World, other: ShipEntity): Reply {
  // Целого не запугать; но стойкий сопротивляется даже избитым, трус пасует раньше.
  const fear = DIALOGUE.PIRACY_FEAR_THRESHOLD - nerve(other.persona) * DIALOGUE.NERVE_SWING
  if (vigour(other) > fear) {
    // Требование сбросить груз — это УГРОЗА, а не слова. Целый торговец не только
    // откажет, но и затаит: повторишь — вызовет охрану и встанет на бой. Решает это
    // движок отношений (`provoke` копит претензию до порога), а не тон реплики.
    provoke(world, other, DIALOGUE.THREAT_WEIGHT)
    return {
      text: other.faction === 'hostile'
        ? 'ХВАТИТ С МЕНЯ! ОХРАНА, ГРАБЁЖ!' // провокация перелила через край — теперь враг
        : 'ПОШЁЛ ПРОЧЬ. Я ВЫЗЫВАЮ ОХРАНУ.',
      agreed: false,
    }
  }

  const { cargo, guns } = plunderEffect(world, other)
  return {
    text: cargo + guns > 0 ? 'ЗАБИРАЙ ВСЁ. ТОЛЬКО НЕ СТРЕЛЯЙ.' : 'У МЕНЯ НИЧЕГО НЕТ. ПУСТОЙ ИДУ.',
    agreed: true,
  }
}

/**
 * Наём. Плата вперёд и разово: наёмник держится рядом и бьёт того, кого ты
 * захватил. Дерётся он вполсилы — медленнее реагирует и шире промахивается,
 * а не бьёт слабее. Слабость пилота, а не поблажка физики.
 */
function hireEscort(world: World, other: ShipEntity): Reply {
  if (!hireEscortEffect(world, other)) return { text: 'ПОКАЖИ ДЕНЬГИ.', agreed: false }
  return { text: 'ДЕНЬГИ ВПЕРЁД — И Я ТВОЙ. ВЕДИ.', agreed: true }
}

/**
 * Приветствие. Тон — по НАСТРОЕНИЮ: свой эскорт рапортует, дружелюбный радуется,
 * насторожённый (ты ему только что грозил) огрызается, враг шлёт прочь. Раньше greet
 * отдавал «чистого неба» безусловно — и выходило, что послал грабителя, а через
 * реплику желаешь ему доброго пути. Теперь реакция следует за отношением, не сама по себе.
 */
function greet(world: World, other: ShipEntity): Reply {
  if (other.ai && other.ai.escortOf === world.player.id) return { text: 'ИДУ ЗА ТОБОЙ, КОМАНДИР.', agreed: true }
  switch (moodTo(world, other)) {
    case 'hostile': return { text: 'НАМ НЕ О ЧЕМ ГОВОРИТЬ. УБИРАЙСЯ.', agreed: false }
    case 'wary': return { text: 'ЧЕГО НАДО? И ДЕРЖИ ПУШКИ ПОДАЛЬШЕ.', agreed: false }
    case 'warm': return { text: 'РАД ТЕБЯ ВИДЕТЬ, КОМАНДИР!', agreed: true }
    case 'neutral': return { text: 'ЧИСТОГО НЕБА, ПИЛОТ.', agreed: true }
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
  if (!line || line.blocked !== null) return { text: line?.blocked ?? '…', agreed: false }

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
