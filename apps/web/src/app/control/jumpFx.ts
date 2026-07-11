import { Quaternion, Vector3 } from 'three'
import { clamp, type Arrival, type World } from '@elite/sim'

/**
 * Кино гиперпрыжка — целиком СЛОЙ ПРИЛОЖЕНИЯ, мимо домена: детерминизм симуляции
 * его не касается, это чистая подача. Одиночка (как и мир) — его читают контроллер
 * игрока, удержание корабля, 3D-кольцо, тряска камеры и затемнение с титром.
 *
 * Отправление разбито на такты (по `t`):
 *   пауза-зарядка — дюзы ревут на полную, корабль дрожит на месте (его держат, а
 *     камера трясётся); впереди в сотне метров разворачивается кольцо;
 *   срыв — корабль импульсом уходит с места и влетает в кольцо;
 *   осознание — секунда полёта по инерции;
 *   затемнение — экран быстро гаснет, под чёрным меняется мир.
 * Прибытие: полсекунды черноты, затем экран светлеет, крупный титр называет систему.
 */

export type JumpPhase = 'depart' | 'arrive'

export interface JumpFx {
  phase: JumpPhase | null
  t: number
  index: number
  arrival: Arrival | null
  name: string
  /** Поза корабля и кольца, снятая на старте. Корабль дрожит на месте и влетает В кольцо. */
  shipStart: Vector3
  forward: Vector3
  ringPos: Vector3
  ringQuat: Quaternion
  ringRadius: number
  /** Импульс срыва даётся один раз. */
  launched: boolean
  /** Сколько метров корабль уже прошёл к кольцу — по этому и раскрывается кольцо. */
  reached: number
  /** Момент (`t`), когда корабль долетел до кольца и пропал. До него — null. */
  enteredAt: number | null
}

const fx: JumpFx = {
  phase: null,
  t: 0,
  index: 0,
  arrival: null,
  name: '',
  shipStart: new Vector3(),
  forward: new Vector3(),
  ringPos: new Vector3(),
  ringQuat: new Quaternion(),
  ringRadius: 20,
  launched: false,
  reached: 0,
  enteredAt: null,
}

export function jumpFx(): JumpFx {
  return fx
}

export function jumping(): boolean {
  return fx.phase !== null
}

// ── Такты отправления, с ─────────────────────────────────────────────────────
// Дальше зарядки время идёт не по секундомеру, а по СОБЫТИЮ: корабль летит в кольцо
// сам (наддув, флайт-ассист), и когда он туда долетит — зависит от его тяги. Поэтому
// схлопывание кольца и затемнение отсчитываются от `enteredAt`, а не от жёстких меток.
/** Конец паузы-зарядки: до сюда корабль держат на месте, дюзы ревут, камера трясётся. */
const CHARGE_END = 1.6
/** Страховка: если корабль почему-то не долетел до кольца, считаем, что влетел. */
const MAX_DASH = 2.5
/** Белый крестообразный блик в миг исчезновения корабля: вспыхивает крупнее кольца и
 *  быстро схлопывается сам — раньше, чем начнёт схлопываться кольцо. */
const FLARE_DUR = 0.22
/** Блик вспыхивает не сразу, а чуть погодя после того, как корабль канул в дыру. */
const FLARE_DELAY = 0.1
/** Кольцо держится, пока сверкает блик, и лишь потом схлопывается — за столько секунд. */
const RING_COLLAPSE = 0.45
/** Пауза после исчезновения корабля до начала затемнения — «через секунду гаснет». */
const DARKEN_DELAY = 1.0
/** Экран уходит в чёрное за столько секунд; на полном чёрном меняем мир. */
const DARKEN_DUR = 0.45
/** Прибытие: полсекунды черноты, затем плавный свет и титр. */
export const ARRIVE_DUR = 2.4

/** Кольцо ставится на столько метров впереди носа — близко, но так, чтобы виден был бросок. */
const RING_DIST = 70
/** Доли пути, на которых кольцо начинает и заканчивает раскрываться: с полпути и до подлёта. */
const RING_OPEN_FROM = 0.5
const RING_OPEN_TO = 0.85
/** Скорость импульса срыва с места, м/с — короткий бросок в полсотни метров должен читаться. */
const LAUNCH_SPEED = 150

const _fwd = new Vector3()
const _rel = new Vector3()

export function startDepart(world: World, index: number, arrival: Arrival | null): void {
  const s = world.player.state
  _fwd.set(0, 0, -1).applyQuaternion(s.quat)
  fx.shipStart.copy(s.pos)
  fx.forward.copy(_fwd)
  fx.ringPos.copy(s.pos).addScaledVector(_fwd, RING_DIST)
  fx.ringQuat.copy(s.quat)
  fx.ringRadius = world.player.spec.hull.radius * 2.25
  fx.phase = 'depart'
  fx.t = 0
  fx.index = index
  fx.arrival = arrival
  fx.name = ''
  fx.launched = false
  fx.reached = 0
  fx.enteredAt = null
}

export function endJump(): void {
  fx.phase = null
  fx.t = 0
  fx.name = ''
}

/**
 * Газ на зарядке прыжка. Не полный сразу, а РЫВКАМИ: несколько дискретных ступеней за
 * секунду. Каждый скачок вверх — всплеск факела (сопла «поддают»), и пламя растёт
 * толчками, пока корабль дрожит на месте. После зарядки — полный газ на срыв.
 */
export function chargeThrottle(): number {
  if (fx.phase !== 'depart' || fx.t >= CHARGE_END) return 1
  const STEPS = 5
  return Math.min(1, Math.ceil((fx.t / CHARGE_END) * STEPS) / STEPS)
}

/** Скрыт ли корабль: он канул в кольцо и до конца отправления его нет в кадре. */
export function shipHidden(): boolean {
  return fx.phase === 'depart' && fx.enteredAt !== null
}

/**
 * Размер кольца, доля. Кольцо раскрывается не по времени, а по тому, где корабль:
 * молчит, пока тот не пройдёт ПОЛПУТИ, затем распахивается к его подлёту, и как
 * только он канул — схлопывается следом.
 */
export function ringScaleNow(): number {
  if (fx.phase !== 'depart') return 0
  if (fx.enteredAt !== null) {
    // Пока сверкает блик (с задержкой) — кольцо держится; потом схлопывается следом.
    const since = fx.t - fx.enteredAt
    if (since < FLARE_DELAY + FLARE_DUR) return 1
    return Math.max(0, 1 - (since - FLARE_DELAY - FLARE_DUR) / RING_COLLAPSE)
  }
  return clamp((fx.reached / RING_DIST - RING_OPEN_FROM) / (RING_OPEN_TO - RING_OPEN_FROM), 0, 1)
}

/** Размер крестового блика, доля: вспыхивает крупным чуть погодя после исчезновения и схлопывается. */
export function flareScale(): number {
  if (fx.phase !== 'depart' || fx.enteredAt === null) return 0
  const k = fx.t - fx.enteredAt - FLARE_DELAY
  if (k < 0) return 0
  return Math.max(0, 1 - k / FLARE_DUR)
}

/** Яркость крестового блика 0..1 — вспышка сразу и быстрое угасание. */
export function flareAlpha(): number {
  return flareScale()
}

/** Отправление завершено: экран полностью чёрен — пора менять мир под ним. */
export function departComplete(): boolean {
  return fx.phase === 'depart' && fx.enteredAt !== null && fx.t >= fx.enteredAt + DARKEN_DELAY + DARKEN_DUR
}

/** Тряска камеры на зарядке 0..1: копится к срыву, коротко подпрыгивает на нём, гаснет. */
export function jumpShake(): number {
  if (fx.phase !== 'depart') return 0
  const t = fx.t
  if (t < CHARGE_END) return 0.15 + 0.85 * (t / CHARGE_END)
  if (t < CHARGE_END + 0.18) return 1
  return 0
}

/** Плотность чёрного 0..1. На отправлении гаснет через секунду после исчезновения корабля. */
export function veilAlpha(): number {
  if (fx.phase === 'depart') {
    if (fx.enteredAt === null) return 0
    return clamp((fx.t - fx.enteredAt - DARKEN_DELAY) / DARKEN_DUR, 0, 1)
  }
  if (fx.phase === 'arrive') return fx.t < 0.5 ? 1 : clamp(1 - (fx.t - 0.5) / 0.6, 0, 1)
  return 0
}

/** Прозрачность титра с именем системы 0..1 — только в прибытии, после того как посветлело. */
export function titleAlpha(): number {
  if (fx.phase !== 'arrive') return 0
  const t = fx.t
  if (t < 0.7) return 0
  if (t < 1.1) return (t - 0.7) / 0.4
  if (t < 1.9) return 1
  return clamp(1 - (t - 1.9) / 0.5, 0, 1)
}

/**
 * Удержать/сорвать корабль на отправлении. Зовётся ПОСЛЕ шага мира: на зарядке
 * гасит любое смещение (корабль ревёт дюзами, но стоит), на срыве даёт импульс
 * вперёд — и дальше корабль летит в кольцо сам.
 */
export function holdOrLaunch(world: World): void {
  if (fx.phase !== 'depart') return
  const s = world.player.state
  if (fx.t < CHARGE_END) {
    s.pos.copy(fx.shipStart)
    s.vel.set(0, 0, 0)
    s.angVel.set(0, 0, 0)
    return
  }
  if (!fx.launched) {
    s.vel.copy(fx.forward).multiplyScalar(LAUNCH_SPEED)
    fx.launched = true
  }
  // Путь к кольцу — по нему раскрывается кольцо; долетел (или вышло время) — фиксируем
  // момент: с него корабль пропадает, а кольцо начинает схлопываться.
  if (fx.enteredAt === null) {
    fx.reached = _rel.copy(s.pos).sub(fx.shipStart).dot(fx.forward)
    if (fx.reached >= RING_DIST || fx.t > CHARGE_END + MAX_DASH) fx.enteredAt = fx.t
  }
}
