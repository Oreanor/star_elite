import { DIALOGUE } from '../../config/dialogue'
import { createAIState } from '../ai/types'
import { healthFraction, shieldFraction } from '../combat/damage'
import { jettisonCargo, jettisonWeapons } from '../combat/salvage'
import type { ShipEntity, World } from '../world/entities'

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

/** С кем вообще можно говорить: захваченный, живой и в пределах слышимости. */
export function interlocutor(world: World): ShipEntity | null {
  const id = world.lockedTargetId
  if (id === null) return null

  const ship = world.ships.find((s) => s.id === id)
  if (!ship?.alive) return null
  if (ship.state.pos.distanceTo(world.player.state.pos) > DIALOGUE.RANGE) return null
  return ship
}

/** Полное здоровье: щит и корпус вместе. Именно его и видит собеседник. */
const vigour = (e: ShipEntity) => (shieldFraction(e) + healthFraction(e)) / 2

/**
 * Что можно сказать этому кораблю. Список зависит от того, кто он: с пиратом
 * торгуются о жизни, с торговцем — о деньгах и о грузе.
 */
export function linesFor(world: World, other: ShipEntity): Line[] {
  const player = world.player

  if (other.faction === 'hostile') {
    return [
      {
        topic: 'surrender',
        say: 'ПРЕКРАТИТЬ ОГОНЬ И СБРОСИТЬ ГРУЗ',
        // Невредимый пират не бросает добычу. Сначала сбей ему щит.
        blocked: healthFraction(other) > 0.99 ? 'ОН НЕВРЕДИМ И НЕ СТАНЕТ СЛУШАТЬ' : null,
      },
      { topic: 'mercy', say: 'ПРОСИТЬ ПОЩАДЫ', blocked: null },
    ]
  }

  return [
    {
      topic: 'escort',
      say: `НАНЯТЬ В СОПРОВОЖДЕНИЕ · ${DIALOGUE.ESCORT_FEE} КР`,
      blocked:
        world.credits < DIALOGUE.ESCORT_FEE
          ? 'НЕ ХВАТАЕТ КРЕДИТОВ'
          : other.ai?.escortOf === player.id
            ? 'ОН УЖЕ ИДЁТ С ТОБОЙ'
            : null,
    },
    { topic: 'plunder', say: 'СБРОСИТЬ ГРУЗ И ОРУЖИЕ', blocked: null },
    { topic: 'greet', say: 'ПРИВЕТСТВОВАТЬ', blocked: null },
  ]
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

function askSurrender(world: World, other: ShipEntity): Reply {
  // Чем сильнее избит, тем охотнее бросает добычу. Целый не сдаётся вовсе.
  const chance = (1 - healthFraction(other)) * DIALOGUE.SURRENDER_GAIN
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

  if (laden) {
    jettisonCargo(world, player)
    surrender(world, other)
    return { text: 'ГРУЗ ЗА БОРТ — И ЛЕТИ. МНЕ ХВАТИТ.', agreed: true }
  }

  surrender(world, other)
  return { text: 'С ТЕБЯ И ВЗЯТЬ НЕЧЕГО. УБИРАЙСЯ.', agreed: true }
}

/**
 * Разбой. Торговец подчиняется, только если напуган: щит сбит или корпус повреждён.
 * Целого и невредимого не запугать — станция рядом, а ты пока никто.
 */
function plunder(world: World, other: ShipEntity): Reply {
  if (vigour(other) > DIALOGUE.PIRACY_FEAR_THRESHOLD) {
    return { text: 'ПОШЁЛ ПРОЧЬ. Я ВЫЗЫВАЮ ОХРАНУ.', agreed: false }
  }

  const cargo = jettisonCargo(world, other)
  const guns = jettisonWeapons(world, other)
  if (other.ai) other.ai.escortOf = null

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
  if (world.credits < DIALOGUE.ESCORT_FEE) return { text: 'ПОКАЖИ ДЕНЬГИ.', agreed: false }

  world.credits -= DIALOGUE.ESCORT_FEE
  other.ai ??= createAIState(other.state.pos, world.rng)
  other.ai.escortOf = world.player.id
  other.ai.skill = DIALOGUE.ESCORT_SKILL
  other.ai.targetId = null
  other.ai.orderedTargetId = null

  return { text: 'ДЕНЬГИ ВПЕРЁД — И Я ТВОЙ. ВЕДИ.', agreed: true }
}

const greet = (other: ShipEntity): Reply => ({
  text: other.ai?.escortOf !== null && other.ai ? 'ИДУ ЗА ТОБОЙ, КОМАНДИР.' : 'ЧИСТОГО НЕБА, ПИЛОТ.',
  agreed: true,
})

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
    case 'greet': return greet(other)
  }
}
