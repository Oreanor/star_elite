import { Vector3 } from 'three'
import { AI, ESCORT, PERCEPTION, ROBBERY, UTILITY } from '../../config/ai'
import { NPC_DOCK } from '../../config/station'
import { TRAFFIC } from '../../config/world'
import { findStation } from '../station/docking'
import type { ShipEntity, World } from '../world/entities'
import { acquaintanceOf, advanceContactPlan, flyContactPlan } from '../world/plan'
import { beginWarpDeparture } from '../world/warp'
import { fight, fightSoft, setMode } from './dogfight'
import { coolManoeuvre } from '../flight/aerobatics'
import { patrolWaypoint } from './maneuvers'
import { forget, memoryFresh, searchPoint, sees } from './perception'
import { issueDemand, preyOf, settleDemand } from './robbery'
import { drive, driveOpts, holdStill } from './steer'
import { selectTarget } from './targeting'
import { assignVoyage, stepTasks } from './tasks'
import { pilotTraits } from './traits'
import type { AIState, BehaviorId } from './types'

/**
 * ПОВЕДЕНИЯ и АРБИТР (Utility AI).
 *
 * Раньше пилот был лестницей `if … return`: сон, прыжок, «стой», «в хвост», план, поручения,
 * автобой, побег, бой, причал, патруль — и кто победит, решал номер строки. Девять полей
 * состояния были девятью частичными автоматами, а новое поведение означало новый `if`.
 *
 * Теперь поведение — ЗАПИСЬ: оценка ситуации числом и исполнение. Арбитр раз в такт
 * размышления берёт наибольшую оценку (текущей — фора `INERTIA`, чтобы бот не метался).
 * Числа — в `UTILITY`; характер (`traits`) умножает боевые. Новое поведение — новая строка
 * в `BEHAVIORS`, а не правка пилота.
 *
 * `run` возвращает false, если делать оказалось нечего (очередь опустела в этом такте): тогда
 * арбитр сразу берёт следующее по оценке — без пустого такта «замер на месте».
 */

export interface BehaviorCtx {
  e: ShipEntity
  ai: AIState
  world: World
  dt: number
  rethink: boolean
  /** Цель боя на этот такт (выбрана в такте размышления, между ними — та же, если видна). */
  target: ShipEntity | null
}

interface Behavior {
  readonly id: BehaviorId
  score(ctx: BehaviorCtx): number
  run(ctx: BehaviorCtx): boolean
}

const _aim = new Vector3()
const _depart = new Vector3()
const _gate = new Vector3(NPC_DOCK.GATE[0], NPC_DOCK.GATE[1], NPC_DOCK.GATE[2])

function quiet(ai: AIState): void {
  ai.wantsFire = false
  ai.wantsMissile = false
}

// ─── Приказы игрока ────────────────────────────────────────────────────────────

/** «Стой тут»: держит место и в бой не лезет, гасит снос ретро-тягой. */
const hold: Behavior = {
  id: 'hold',
  score: ({ ai }) => (ai.command === 'hold' ? UTILITY.ORDER : 0),
  run({ e, ai }) {
    holdStill(e, true)
    quiet(ai)
    return true
  },
}

/** Ближе этого враг — уходим от боя: беречь себя и груз важнее геройства, м. */
const KEEP_BACK_THREAT = 3_500

/**
 * «Держись в хвосте». Есть угроза рядом — уходит от неё на форсаже, не стреляя; нет —
 * держится возле нанимателя патрульным кругом. Это не трусость, а исполнение приказа.
 */
const keepBack: Behavior = {
  id: 'keep-back',
  score: ({ ai }) => (ai.command === 'keepBack' ? UTILITY.ORDER : 0),
  run({ e, ai, world }) {
    quiet(ai)
    ai.targetId = null
    const threat = selectTarget(e, world)
    if (threat && threat.state.pos.distanceTo(e.state.pos) < KEEP_BACK_THREAT) {
      // Прочь от угрозы: точка по ту сторону от себя.
      _aim.copy(e.state.pos).multiplyScalar(2).sub(threat.state.pos)
      drive(e, world, _aim, driveOpts({ boost: AI.ESCAPE_BOOST }))
      return true
    }
    const patron = patronOf(e, world)
    if (patron) ai.home.copy(patron.state.pos)
    patrol(e, ai, world)
    return true
  },
}

/** Автобой игрока по обломку/астероиду: приказ, а не выбор. */
const soft: Behavior = {
  id: 'soft',
  score: ({ ai }) => (ai.orderedSoft ? UTILITY.ORDER : 0),
  run: ({ e, ai, world, dt, rethink }) => fightSoft(e, ai, world, dt, rethink),
}

// ─── Побег прыжком ─────────────────────────────────────────────────────────────

/**
 * Заряжает прыжок-побег: уходит от угрозы, ни во что не стреляя, и уязвим, пока мигает.
 * Решение начать — в такте размышления (`considerEscape` в пилоте); тут только исполнение.
 */
const escape: Behavior = {
  id: 'escape',
  score: ({ ai }) => (ai.warpTimer >= 0 ? UTILITY.ORDER * 10 : 0),
  run({ e, ai, world, dt }) {
    ai.warpTimer -= dt
    quiet(ai)
    ai.wantsEcm = false
    const danger = nearestDanger(e, world)
    if (danger) {
      _aim.copy(e.state.pos).multiplyScalar(2).sub(danger.state.pos)
      drive(e, world, _aim, driveOpts({ boost: AI.ESCAPE_BOOST }))
    }
    if (ai.warpTimer <= 0) beginWarpDeparture(world, e)
    return true
  },
}

/**
 * Ближайшая угроза: тот, от кого бежать. Для мирного это игрок или личный враг; для
 * боевого — любой, кто ему враг. Видимость не спрашиваем: бегущий оглядывается на всех.
 */
function nearestDanger(e: ShipEntity, world: World): ShipEntity | null {
  return selectTarget(e, world) ?? (world.player.alive ? world.player : null)
}

// ─── Дела ──────────────────────────────────────────────────────────────────────

/**
 * План знакомого (док → покупка → вылет → эскорт). Пока голова плана — «в док», бот ИДЁТ
 * к причалу. Прежде пилот здесь возвращался, ничего не рулив, — знакомый, которому велели
 * стыковаться, дрейфовал с рулями прошлого режима.
 */
const plan: Behavior = {
  id: 'plan',
  score: ({ e, world }) => (e.acquaintanceId != null && acquaintanceOf(world, e)?.plan.queue.length ? UTILITY.PLAN : 0),
  run(ctx) {
    const { e, ai, world } = ctx
    if (flyContactPlan(e, world)) {
      flyDock(ctx)
      return true
    }
    if (ai.dock === 'berthed') advanceContactPlan(world, e)
    return false
  },
}

/**
 * Очередь задач: поручения из разговора и свой промысел (рейс и уход). Поручение важнее
 * промысла; оба уступают приказу, а промысел — и бою.
 */
const tasks: Behavior = {
  id: 'tasks',
  score: ({ ai }) => {
    const head = ai.tasks[0]
    if (!head) return 0
    return head.urgent ? UTILITY.ORDER : head.own ? UTILITY.ROUTINE : UTILITY.TASK
  },
  run({ e, ai, world }) {
    const intent = stepTasks(e, world)
    if (!intent) return false
    drive(e, world, intent.target, driveOpts({ arriveRadius: intent.arriveRadius }))
    quiet(ai)
    ai.wantsEcm = false
    return true
  },
}

// ─── Бой и его родня ───────────────────────────────────────────────────────────

/**
 * Бой с целью. Оценка — тяга к драке: прямой приказ «бей» выше поручений; под огнём
 * (стрелок — эта цель) бой перебивает поручение у храброго, но не у труса; иначе обычная.
 */
const combat: Behavior = {
  id: 'combat',
  score({ e, ai, world, target }) {
    if (!target) return 0
    if (ai.command === 'attack' || ai.command === 'engageAll') return UTILITY.ORDER - 5
    const aggression = pilotTraits(e).aggression
    const underFire = e.lastAttackerId === target.id && world.time - e.lastHitAt < PERCEPTION.FIRE_AWARE
    return (underFire ? UTILITY.SELF_DEFENSE : UTILITY.COMBAT) * aggression
  },
  run(ctx) {
    const { e, ai, world, dt, rethink, target } = ctx
    if (!target) return false
    fight(e, ai, target, world, dt, rethink)
    return true
  },
}

/**
 * Поиск потерянной цели: идёт туда, где видел её в последний раз, с поправкой на её ход.
 * Дошёл и не нашёл — забывает. Мирные не ищут: им бы уйти, а не догонять.
 */
const search: Behavior = {
  id: 'search',
  score({ e, world, target }) {
    if (target || e.faction === 'neutral' || !memoryFresh(e, world.time)) return 0
    return UTILITY.SEARCH * pilotTraits(e).aggression
  },
  run({ e, ai, world }) {
    searchPoint(e, world.time, _aim)
    const left = drive(e, world, _aim, driveOpts({ throttle: 0.8, arriveRadius: PERCEPTION.SEARCH_ARRIVE }))
    quiet(ai)
    if (left < PERCEPTION.SEARCH_ARRIVE) forget(e)
    return true
  },
}

/**
 * Грабёж. Пират подходит к мирному с грузом, требует сбросить трюм и ждёт ответа. Ответ —
 * один бросок по характеру и силам (`settleDemand`); отказ превращает дело в бой.
 * Жадный предпочитает грабёж драке с игроком, вспыльчивый — наоборот: оценки двигает нрав.
 */
const rob: Behavior = {
  id: 'rob',
  score({ e, world }) {
    if (e.faction !== 'hostile' || !preyOf(e, world)) return 0
    return UTILITY.ROB + UTILITY.ROB_GREED * pilotTraits(e).greed
  },
  run({ e, ai, world }) {
    const prey = preyOf(e, world)
    if (!prey) {
      ai.preyId = null
      ai.demandAt = -1
      return false
    }
    // Держится на расстоянии требования, идя вровень с жертвой.
    const d = drive(e, world, prey.state.pos, driveOpts({ arriveRadius: ROBBERY.HOLD_RANGE }))
    quiet(ai)
    if (ai.demandAt < 0) {
      if (d < ROBBERY.DEMAND_RANGE && sees(e, prey, world)) issueDemand(world, e, prey)
    } else if (world.time - ai.demandAt >= ROBBERY.PONDER) {
      settleDemand(world, e, prey)
    }
    return true
  },
}

// ─── Эскорт ────────────────────────────────────────────────────────────────────

const _toPatron = new Vector3()
const _nose = new Vector3()

/**
 * Отставший эскорт идёт к нанимателю полным газом с форсажем, а на большом разрыве просит
 * крейсер-защёлку. Множитель пропорционален разрыву, поэтому ход гаснет сам по мере
 * сближения. Массовая блокировка и выход у звезды — правила `updateCruise`, общие с игроком:
 * рядом с врагом бот крейсер не получит, как и ты.
 */
const rejoin: Behavior = {
  id: 'rejoin',
  score({ e, ai, world }) {
    if (ai.command !== 'default' || ai.dock === 'berthed') return 0
    const patron = patronOf(e, world)
    if (!patron) return 0
    // Гистерезис: начинает догонять дальше REJOIN_RANGE, бросает только ближе REJOIN_DONE.
    const range = ai.behavior === 'rejoin' ? ESCORT.REJOIN_DONE : ESCORT.REJOIN_RANGE
    return e.state.pos.distanceToSquared(patron.state.pos) > range * range ? UTILITY.REJOIN : 0
  },
  run({ e, ai, world }) {
    const patron = patronOf(e, world)
    if (!patron) return false
    // Сорвался из очереди к причалу — освободи причал, иначе он заперт навсегда.
    if (ai.dock === 'inbound') {
      if (world.dockOccupantId === e.id) world.dockOccupantId = null
      ai.dock = null
    }
    ai.home.copy(patron.state.pos)
    const gap = drive(e, world, patron.state.pos, driveOpts({ throttle: 1, boost: AI.ESCAPE_BOOST, arriveRadius: ESCORT.REJOIN_DONE }))
    quiet(ai)

    _toPatron.copy(patron.state.pos).sub(e.state.pos).divideScalar(Math.max(gap, 1))
    _nose.set(0, 0, -1).applyQuaternion(e.state.quat)
    const factor = gap / (e.spec.tuning.MAX_SPEED * ESCORT.CATCHUP_TIME)
    if (factor > 1 && _nose.dot(_toPatron) > ESCORT.CRUISE_ALIGN) ai.cruiseHold = factor
    return true
  },
}

// ─── Мирная жизнь ──────────────────────────────────────────────────────────────

/** Очередь к причалу и стоянка. */
const dock: Behavior = {
  id: 'dock',
  score: ({ ai }) => (ai.dock === 'inbound' || ai.dock === 'berthed' ? UTILITY.DOCK : 0),
  run(ctx) {
    flyDock(ctx)
    return true
  },
}

/** Ничего не надо — кружит у дома. Всегда есть: арбитру всегда есть что выбрать. */
const patrolling: Behavior = {
  id: 'patrol',
  score: () => UTILITY.PATROL,
  run({ e, ai, world }) {
    patrol(e, ai, world)
    return true
  },
}

/** Порядок — только для ничьей: при равных оценках побеждает стоящий раньше. */
const BEHAVIORS: readonly Behavior[] = [escape, hold, keepBack, soft, plan, tasks, combat, rejoin, rob, search, dock, patrolling]

/**
 * Выбрать поведение. `skip` — битовая маска уже отказавшихся в этом такте (их `run` вернул
 * false). Текущему — фора `INERTIA`. Без аллокаций: идёт по модульному списку.
 */
export function arbitrate(ctx: BehaviorCtx, skip: number): number {
  let best = BEHAVIORS.length - 1
  let bestScore = -Infinity
  for (let i = 0; i < BEHAVIORS.length; i++) {
    if (skip & (1 << i)) continue
    const b = BEHAVIORS[i]!
    let s = b.score(ctx)
    if (s <= 0) continue
    if (b.id === ctx.ai.behavior) s *= UTILITY.INERTIA
    if (s > bestScore) {
      bestScore = s
      best = i
    }
  }
  return best
}

/**
 * Исполнить поведение текущего такта. Отказавшееся (`run` → false) уступает следующему по
 * оценке тут же; патруль не отказывает никогда, поэтому цикл конечен.
 */
export function runBehavior(ctx: BehaviorCtx, decide: boolean): void {
  coolManoeuvre(ctx.ai.manoeuvre, ctx.dt)
  runChosen(ctx, decide)
  // Фигура — боевая: ушёл из боя (побег, причал, приказ) — штурвал не держит недокрученная.
  const m = ctx.ai.manoeuvre
  if (ctx.ai.behavior !== 'combat' && m.kind !== null) {
    m.kind = null
    m.nextKind = null
  }
}

function runChosen(ctx: BehaviorCtx, decide: boolean): void {
  let skip = 0
  let index = decide ? arbitrate(ctx, 0) : indexOf(ctx.ai.behavior)
  for (let guard = 0; guard < BEHAVIORS.length; guard++) {
    const b = BEHAVIORS[index]!
    ctx.ai.behavior = b.id
    if (b.score(ctx) > 0 && b.run(ctx)) return
    skip |= 1 << index
    index = arbitrate(ctx, skip)
  }
}

function indexOf(id: BehaviorId): number {
  for (let i = 0; i < BEHAVIORS.length; i++) if (BEHAVIORS[i]!.id === id) return i
  return BEHAVIORS.length - 1
}

// ─── Общие манёвры ─────────────────────────────────────────────────────────────

/** Наниматель (кого сопровождает), если жив. */
export function patronOf(e: ShipEntity, world: World): ShipEntity | null {
  const id = e.ai?.escortOf
  if (id == null) return null
  const p = id === world.player.id ? world.player : world.ships.find((s) => s.id === id)
  return p?.alive ? p : null
}

function patrol(e: ShipEntity, ai: AIState, world: World): void {
  setMode(ai, 'patrol')
  if (ai.modeTimer > 8 || ai.waypoint.distanceTo(e.state.pos) < 120) {
    ai.modeTimer = 0
    patrolWaypoint(ai, world.time, ai.waypoint)
  }
  drive(e, world, ai.waypoint, driveOpts({ throttle: 0.35 }))
  quiet(ai)
}

/** Точка перед причальными воротами: заходят и швартуются здесь, а не в центре станции. */
function berthPoint(stationPos: Vector3, radius: number, out: Vector3): Vector3 {
  return out.copy(_gate).multiplyScalar(radius + NPC_DOCK.BERTH_RANGE * 0.5).add(stationPos)
}

/**
 * Стыковка трафика к причалу — ПО ОДНОМУ. Причал держит `world.dockOccupantId`:
 * занявший его заходит и швартуется, остальные ждут на кольце ожидания и займут
 * место, едва оно освободится. Игрока это не касается: он стыкуется своим путём
 * (`docked` замораживает мир). Здесь мир живёт, поэтому «стоянка» — не остановка
 * мира, а корабль, гасящий ход у причала на несколько секунд.
 *
 * Отстоявший уходит СВОИМ РЕЙСОМ — до точки ухода и прыжком (`assignVoyage`). Знакомые и
 * наёмники — нет: знакомый живёт в своей системе, его всегда найдёшь у причала.
 */
function flyDock({ e, ai, world, dt }: BehaviorCtx): void {
  quiet(ai)
  const station = findStation(world)
  if (!station) {
    // Стыковаться не к чему (прыгнули в систему без причала) — обычный полёт.
    ai.dock = null
    patrol(e, ai, world)
    return
  }

  if (ai.dock === 'berthed') {
    e.clearance = true // у причала корабль под защитой станции: его не бьют
    ai.dockTimer -= dt
    berthPoint(station.pos, station.radius, _aim)
    drive(e, world, _aim, driveOpts({ throttle: 0, separate: false }))
    e.controls.retro = e.state.vel.length() > 2 ? 1 : 0 // гасит остаточный ход у ворот
    if (ai.dockTimer <= 0) {
      if (world.dockOccupantId === e.id) world.dockOccupantId = null
      e.clearance = false
      ai.dock = 'done'
      // Уходит наружу от станции — прямо от своего места, чтобы не толкаться у причала.
      _depart.copy(e.state.pos).sub(station.pos)
      if (_depart.lengthSq() < 1) _depart.copy(_gate)
      _depart.normalize()
      ai.home.copy(station.pos).addScaledVector(_depart, station.radius + TRAFFIC.DESTINATION_RANGE)
      ai.waypoint.copy(ai.home)
      if (e.acquaintanceId == null && ai.escortOf == null && !e.divine) assignVoyage(e, ai.home)
    }
    return
  }

  if (ai.dock !== 'inbound') {
    patrol(e, ai, world)
    return
  }

  // inbound: занять причал, если свободен, иначе — в очередь.
  const mine = world.dockOccupantId === e.id
  if (world.dockOccupantId === null || mine) {
    if (!mine) world.dockOccupantId = e.id
    berthPoint(station.pos, station.radius, _aim)
    const toBerth = e.state.pos.distanceTo(_aim)
    // Ход тем меньше, чем ближе причал: влететь в кольцо на полном — таран.
    const throttle = toBerth > NPC_DOCK.BRAKE_RANGE ? 0.6 : Math.min(0.6, Math.max(0.06, toBerth / NPC_DOCK.BRAKE_RANGE))
    // Сам причал облетать не надо: ворота — на сфере станции, обход увёл бы прочь.
    drive(e, world, _aim, driveOpts({ throttle, avoid: false, separate: false }))
    if (toBerth < NPC_DOCK.BERTH_RANGE) {
      e.clearance = true
      if (e.state.vel.length() < NPC_DOCK.BERTH_SPEED) {
        ai.dock = 'berthed'
        ai.dockTimer = NPC_DOCK.DWELL
      }
    }
    return
  }

  // Причал занят — ждём очередь на кольце поодаль, не претендуя на место.
  e.clearance = false
  _aim.copy(e.state.pos).sub(station.pos)
  if (_aim.lengthSq() < 1) _aim.copy(_gate)
  _aim.normalize().multiplyScalar(station.radius + NPC_DOCK.QUEUE_RANGE).add(station.pos)
  drive(e, world, _aim, driveOpts({ throttle: 0.4, arriveRadius: 200 / AI.ARRIVE_BRAKE }))
}
