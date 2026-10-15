import { AI, WARP } from '../../config/ai'
import { chanceWithin } from '../../core/math'
import { isEngageable } from '../combat/engage'
import type { Controller } from '../sim/controller'
import type { ShipEntity, World } from '../world/entities'
import { lockedShipId } from '../world/queries'
import { patronOf, runBehavior, type BehaviorCtx } from './behaviors'
import { decideEcm } from './dogfight'
import { forget, knowsOf, memoryFresh } from './perception'
import { choosePrey } from './robbery'
import { holdStill } from './steer'
import { isFoe, isHostileTo, selectTarget } from './targeting'
import { clearOwnTasks, enqueueTask } from './tasks'
import { pilotTraits } from './traits'
import type { AIState } from './types'

/**
 * Пилот-бот. Реализует тот же `Controller`, что и игрок: заполняет ShipControls
 * и ничего больше. Физика у него ровно та же — превзойти тебя он может только
 * решением, не привилегией.
 *
 * Устройство — три слоя, как принято в игровом ИИ:
 *   • ЧУВСТВА (`perception.ts`) — кого видит, кого помнит, кто в него стреляет;
 *   • РЕШЕНИЕ (`behaviors.ts`) — арбитр выбирает поведение по оценкам раз в такт размышления;
 *   • РУЛЁЖКА (`steer.ts`) — как довести нос до точки, не врезавшись.
 * Здесь — только часы размышления и то, что пилот замечает в каждом такте размышления.
 */

// Один контекст на модуль: пилоты зовутся по очереди, не вложенно.
const _ctx: BehaviorCtx = {
  e: null as unknown as ShipEntity,
  ai: null as unknown as AIState,
  world: null as unknown as World,
  dt: 0,
  rethink: false,
  target: null,
}

export const aiController: Controller = {
  update(e: ShipEntity, world: World, dt: number): void {
    const ai = e.ai
    if (!ai || !e.alive) return

    // Спящий экипаж платформы: сидит на палубе, пока гнездо не поднято. Ни хода,
    // ни цели, ни огня — его можно вырезать по одному, и он не шевельнётся.
    // Это состояние тела, а не выбор: арбитру тут решать нечего.
    if (ai.dormant || e.warpEmerging || e.warpDeparting) {
      holdStill(e, false)
      ai.wantsFire = false
      ai.wantsMissile = false
      ai.wantsEcm = false
      ai.cruiseHold = 0
      return
    }

    ai.modeTimer += dt
    ai.cruiseHold = 0
    ai.wantsFire = false
    ai.wantsMissile = false
    ai.missileCooldown = Math.max(0, ai.missileCooldown - dt)

    // Единственные «часы размышления». Выучка и ум растягивают/сжимают время реакции:
    // слабый пилот думает дольше, а не бьёт слабее.
    ai.thinkTimer -= dt
    const rethink = ai.thinkTimer <= 0
    if (rethink) {
      ai.thinkSpan = (AI.THINK_INTERVAL * pilotTraits(e).reaction) / ai.skill
      ai.thinkTimer = ai.thinkSpan
    }

    const ctx = _ctx
    ctx.e = e
    ctx.ai = ai
    ctx.world = world
    ctx.dt = dt
    ctx.rethink = rethink
    ctx.target = rethink ? perceive(e, ai, world) : resolveTarget(e, world)

    runBehavior(ctx, rethink)
  },

  wantsFire(e: ShipEntity): boolean {
    return e.ai?.wantsFire ?? false
  },

  wantsMissile(e: ShipEntity): boolean {
    return e.ai?.wantsMissile ?? false
  },

  wantsEcm(e: ShipEntity): boolean {
    return e.ai?.wantsEcm ?? false
  },

  wantsCruise(e: ShipEntity): boolean | number {
    const hold = e.ai?.cruiseHold ?? 0
    return hold > 1 ? hold : false
  },

  missileTarget(e: ShipEntity): number | null {
    return e.ai?.targetId ?? null
  },
}

/**
 * ТАКТ РАЗМЫШЛЕНИЯ: что пилот замечает. Чистит память, решает о ПРО, выбирает цель,
 * присматривает жертву (пират) и думает о побеге. Возвращает цель боя (или null).
 */
function perceive(e: ShipEntity, ai: AIState, world: World): ShipEntity | null {
  pruneFoes(ai, world)
  // ПРО решается независимо от цели и поведения: ракета летит и в патрулирующего.
  decideEcm(e, ai, world)

  const target = selectAndRemember(e, world)
  if (!target && ai.lastSeenId != null && !memoryFresh(e, world.time)) forget(e)

  // Пират присматривает жертву, если свободен: не наёмник, не под приказом, не в деле.
  if (e.faction === 'hostile' && ai.preyId == null && ai.escortOf == null && ai.command === 'default' && ai.tasks.length === 0) {
    ai.preyId = choosePrey(e, world)?.id ?? null
  }

  considerEscape(e, ai, world)
  return target
}

/** Личные враги, которых больше нет в системе или в живых, — забыть. */
function pruneFoes(ai: AIState, world: World): void {
  if (ai.foes.length === 0) return
  ai.foes = ai.foes.filter((id) => (id === world.player.id ? world.player.alive : world.ships.some((s) => s.id === id && s.alive)))
}

/**
 * Побег из системы прыжком. Кто бежит: напуганный (уже в `evade`) или недавно обстрелянный,
 * — но только по своей воле (не под приказом, не наёмник, не в поручении) и при приводе.
 * Решение — бросок из ТЕМПА в секундах за длину такта (`WARP.RATE`), не шанс «за такт».
 */
function considerEscape(e: ShipEntity, ai: AIState, world: World): void {
  if (ai.warpTimer >= 0 || e.spec.jumpRange <= 0) return
  if (ai.command !== 'default' || ai.escortOf != null || ai.orderedSoft) return
  if (ai.tasks.length > 0 && !ai.tasks[0]!.own) return
  if (e.acquaintanceId != null) return
  const underFire = world.time - e.lastHitAt < WARP.THREAT_WINDOW
  if (!underFire && ai.mode !== 'evade') return
  if (world.rng() >= chanceWithin(WARP.RATE, ai.thinkSpan)) return
  ai.warpTimer = WARP.CHARGE
}

/**
 * Наёмник живёт чужой волей: он держится рядом с нанимателем и бьёт того, кого
 * тот захватил. Своей цели он не выбирает — он ведомый, а не второй пилот.
 *
 * Приказ переписывается КАЖДЫЙ такт размышления, а не выдаётся однажды: наниматель
 * меняет захват в бою, и ведомый обязан узнавать об этом со своей задержкой
 * реакции — не мгновенно и не никогда.
 */
function followEscort(e: ShipEntity, world: World): void {
  const ai = e.ai!
  if (ai.escortOf === null) return

  const patron = patronOf(e, world)
  if (!patron) {
    // Нанимателя больше нет. Контракт с мёртвым не исполняют.
    ai.escortOf = null
    ai.orderedTargetId = null
    return
  }

  // Наниматель уходит прыжком — звено уходит с ним, а не кружит над пустым местом.
  if (patron.warpDeparting && patron !== world.player) {
    if (!ai.tasks.some((t) => t.kind === 'depart')) enqueueTask(e, { kind: 'depart', own: true })
    return
  }

  // Дом наёмника — там, где наниматель: без этого он патрулирует место найма
  // и остаётся позади, стоило игроку тронуться с места.
  ai.home.copy(patron.state.pos)

  const wanted = patron === world.player ? lockedShipId(world) : (patron.ai?.targetId ?? null)
  const enemy = wanted === null ? null : world.ships.find((s) => s.id === wanted)
  // Мирного по приказу не бьют — наёмник не убийца по найму, — а невидимку
  // и стыкующегося просто не берут на прицел.
  ai.orderedTargetId = enemy && isEngageable(enemy) && (isHostileTo(e.faction, enemy.faction) || isFoe(patron, enemy)) ? enemy.id : null
}

function selectAndRemember(e: ShipEntity, world: World): ShipEntity | null {
  const ai = e.ai!

  // Прямой приказ игрока перекрывает и авто-выбор цели, и следование за нанимателем:
  // бот подчиняется, а не решает.
  if (ai.command === 'standDown' || ai.command === 'hold' || ai.command === 'keepBack') {
    // Никого не атакуем. Полёт (следование/патруль) остаётся — не бьём, и только.
    ai.targetId = null
    return null
  }
  if (ai.command === 'attack') {
    ai.targetId = ai.orderedTargetId
    const ordered = resolveTarget(e, world)
    // Цель уничтожена или пропала — приказ исполнен, бот возвращается к обычному поведению.
    if (!ordered) {
      ai.command = 'default'
      ai.orderedTargetId = null
    }
    return ordered
  }
  if (ai.command === 'engageAll') {
    // Свободный огонь: бьёт любого враждебного вокруг, даже будучи эскортом игрока.
    const enemy = selectTarget(e, world)
    ai.targetId = enemy?.id ?? null
    return enemy
  }

  // default — наёмник тянется за целью нанимателя, прочие решают сами.
  followEscort(e, world)

  // Приказ отменяет выбор. Иначе в такте размышления пилот перескочил бы
  // на ближайшего врага, и автобой перестал бы драться с тем, кого захватили.
  if (ai.orderedTargetId !== null) {
    ai.targetId = ai.orderedTargetId
    return resolveTarget(e, world)
  }
  // Наёмник без захваченной цели сам ЗАЩИЩАЕТ нанимателя: берёт враждебного рядом.
  // Прочие — ближайшего врага, о котором знают (видят или получили от него).
  const target = selectTarget(e, world)
  ai.targetId = target?.id ?? null
  return target
}

/**
 * Между размышлениями цель не пересматривается — только проверяется, что она ещё в
 * пределах чувств. Ушла за планету — бой прерывается до следующего размышления, а там
 * пилот пойдёт искать её по памяти.
 */
function resolveTarget(e: ShipEntity, world: World): ShipEntity | null {
  const id = e.ai?.targetId
  if (id == null) return null
  const target = id === world.player.id ? world.player : world.ships.find((s) => s.id === id)
  if (!target || !isEngageable(target)) return null
  // Приказанную цель знает по приказу (наводка нанимателя), а не своими глазами.
  if (e.ai!.orderedTargetId === id) return target
  return knowsOf(e, target, world) ? target : null
}

/** Нанятого или получившего приказ — освободить от своего промысла (рейс подождёт). */
export function yieldOwnErrands(e: ShipEntity): void {
  clearOwnTasks(e)
  if (e.ai) {
    e.ai.preyId = null
    e.ai.demandAt = -1
  }
}

