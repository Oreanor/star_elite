import { Quaternion, Vector3 } from 'three'
import { AI } from '../../config/ai'
import { clamp } from '../../core/math'
import { bankToward } from '../flight/steering'
import type { ShipEntity, World } from '../world/entities'
import { avoidBodies } from './maneuvers'
import { pilotTraits } from './traits'

/**
 * СЛОЙ РУЛЁЖКИ: «куда и как» → `ShipControls`. Мозг (поведения в `behaviors.ts`) решает,
 * ЧТО делать, и отдаёт точку; как довести до неё нос, не врезавшись в станцию и в соседа,
 * знает только этот модуль. Раньше каждое поведение само звало `steerToward`+`bankToward`
 * и само тормозило у цели — семь копий с тремя разными порогами торможения, а облёт тел
 * был только в бою: бот с поручением шёл к станции сквозь планету.
 *
 * Это steering behaviors Рейнольдса в упрощённом виде: seek/arrive + obstacle avoidance
 * + separation складываются в ОДНУ точку руления, и уже она переводится в рули.
 */

export interface DriveOptions {
  /** Тяга вне зоны торможения, 0..1. */
  throttle: number
  /** Форсаж, множитель (1 — без форсажа). */
  boost: number
  /**
   * Радиус прибытия, м. Задан — ведём с торможением (arrive): за `ARRIVE_BRAKE` радиусами
   * полный ход, ближе — пропорционально дистанции, у самой точки гасим снос ретро-тягой.
   * `null` — идём на точку не тормозя (погоня, бегство, патруль).
   */
  arriveRadius: number | null
  /** Обходить тела (станции, планеты). Выключают только там, где обход сам и есть цель. */
  avoid: boolean
  /**
   * Расходиться с соседями. В бою выключено: там сближение с противником — смысл манёвра,
   * а развод на проскоке делает режим `break`.
   */
  separate: boolean
  /**
   * Скорость точки, за которой ведём нос (цель в бою), м/с. Есть — к развороту добавляется
   * угловая скорость линии визирования: вблизи цель уходит вбок быстрее, чем нос догоняет
   * её по одной ошибке угла. `null` — точка неподвижна.
   */
  aimVel: Vector3 | null
}

const DEFAULTS: DriveOptions = { throttle: 1, boost: 1, arriveRadius: null, avoid: true, separate: true, aimVel: null }
// Один объект опций на модуль: собирать его литералом в каждом такте — мусор для GC.
const _opts: DriveOptions = { ...DEFAULTS }

/** Опции рулёжки поверх умолчаний. Возвращает модульный объект — не хранить. */
export function driveOpts(over: Partial<DriveOptions>): DriveOptions {
  Object.assign(_opts, DEFAULTS, over)
  return _opts
}

const _steerAim = new Vector3()
const _away = new Vector3()
const _steer = { pitch: 0, yaw: 0 }

/**
 * Сдвинуть точку руления прочь от слишком близких соседей. Сдвиг — поперёк пути и тем
 * сильнее, чем ближе сосед: так очередь у причала не слипается в один ком, а звено не
 * таранит своего же ведомого. Цель погони сюда не попадает: в бою separation выключен.
 */
function separate(e: ShipEntity, world: World, aim: Vector3): void {
  const reach = AI.SEPARATION_RANGE + e.spec.hull.radius
  const dist = aim.distanceTo(e.state.pos)
  if (dist < 1) return
  for (let i = -1; i < world.ships.length; i++) {
    const o = i < 0 ? world.player : world.ships[i]!
    if (o === e || !o.alive) continue
    const limit = reach + o.spec.hull.radius
    const dSq = o.state.pos.distanceToSquared(e.state.pos)
    if (dSq >= limit * limit || dSq < 1e-6) continue
    const d = Math.sqrt(dSq)
    // Вес 0..1: у самой кромки ноль, вплотную — единица. Сдвиг масштабируем дистанцией до
    // цели, чтобы угол отворота не зависел от того, далеко ли мы правим.
    const w = 1 - d / limit
    _away.copy(e.state.pos).sub(o.state.pos).divideScalar(d)
    aim.addScaledVector(_away, w * dist * AI.SEPARATION_WEIGHT)
  }
}

const _toAim = new Vector3()
const _relVel = new Vector3()
const _los = new Vector3()
const _inv = new Quaternion()

/**
 * Команды тангажа и рыскания, чтобы нос ПРИШЁЛ на точку и ОСТАНОВИЛСЯ на ней.
 *
 * Прежде руль был пропорционален углу (`steerToward` с усилением): ручка задаёт желаемую
 * угловую скорость, а разгон носа ограничен ускорением, — и корабль с быстрыми маневровыми
 * (улучшенными, лёгкий истребитель) разгонял нос, не успевал погасить его и проскакивал цель;
 * вблизи бот вертелся на месте, а цель в прицел почти не попадала. Замер: средняя ошибка
 * носа 16–38°, угловая скорость больше 1 рад/с.
 *
 * Теперь по каждой оси — наибольшая скорость, с которой ещё успеваешь затормозить к нулю
 * ошибки: ω = √(2·α·|θ|) (α — угловое ускорение ЭТОГО корабля, запас — выучка пилота), плюс
 * угловая скорость линии визирования: цель, идущая поперёк, требует вращения и при нулевой
 * ошибке. Ручка = ω / предел скорости оси.
 */
function aimRates(e: ShipEntity, aim: Vector3, aimVel: Vector3 | null, out: { pitch: number; yaw: number }): void {
  const s = e.state
  const t = e.spec.tuning
  _toAim.copy(aim).sub(s.pos)
  const dist = _toAim.length()
  if (dist < 1e-3) {
    out.pitch = 0
    out.yaw = 0
    return
  }
  _inv.copy(s.quat).invert()

  // Линия визирования вращается со скоростью (r × v_отн) / r² — в связанных осях.
  _los.set(0, 0, 0)
  if (aimVel) {
    _relVel.copy(aimVel).sub(s.vel)
    _los.crossVectors(_toAim, _relVel).divideScalar(dist * dist).applyQuaternion(_inv)
  }

  _toAim.divideScalar(dist).applyQuaternion(_inv)
  const pitchErr = Math.asin(clamp(_toAim.y, -1, 1))
  const yawErr = Math.atan2(_toAim.x, -_toAim.z)

  // Запас на торможение: ловкий тормозит позже, неловкий — раньше (честная слабость, не урон).
  const margin = clamp(AI.AIM_BRAKE_MARGIN * pilotTraits(e).reflex, 0.3, 0.95)
  const brake = (err: number, accel: number) => Math.sign(err) * Math.sqrt(2 * accel * margin * Math.abs(err))

  // Знаки — как у ручки: +тангаж поднимает нос (angVel.x = pitch·RATE); рыскание — минус
  // (angVel.y = −yaw·RATE), поэтому и вклад линии визирования по Y входит с минусом.
  const pitchRate = brake(pitchErr, t.PITCH_ACCEL) + _los.x
  const yawRate = brake(yawErr, t.YAW_ACCEL) - _los.y
  out.pitch = clamp(pitchRate / t.PITCH_RATE, -1, 1)
  out.yaw = clamp(yawRate / t.YAW_RATE, -1, 1)
}

/**
 * Вести корабль к точке `aim`. Пишет ВСЕ рули (тангаж, рыскание, крен, газ, ретро, форсаж,
 * ассистент) — поведение, позвавшее `drive`, получает корабль в известном состоянии и не
 * оставляет в рулях мусор прошлого режима. Возвращает дистанцию до `aim`, м.
 */
export function drive(e: ShipEntity, world: World, aim: Vector3, opts: DriveOptions = DEFAULTS): number {
  const c = e.controls
  const distance = e.state.pos.distanceTo(aim)

  _steerAim.copy(aim)
  if (opts.avoid) avoidBodies(e.state.pos, aim, world.bodies, _steerAim)
  if (opts.separate) separate(e, world, _steerAim)

  // Нос — по закону «успеть затормозить», а не «пропорционально углу» (см. `aimRates`).
  aimRates(e, _steerAim, opts.aimVel, _steer)
  c.pitch = _steer.pitch
  c.yaw = _steer.yaw
  c.roll = bankToward(e.state, _steerAim)
  c.rudder = 0
  c.strafe = 0
  c.strafeUp = 0
  c.flightAssist = true
  c.boost = opts.boost

  if (opts.arriveRadius == null) {
    c.throttle = opts.throttle
    c.retro = 0
    return distance
  }

  const brake = opts.arriveRadius * AI.ARRIVE_BRAKE
  c.throttle = distance > brake ? opts.throttle : clamp(distance / brake, 0.06, opts.throttle)
  // У самой точки гасим снос, иначе проскочим и будем нарезать круги.
  c.retro = distance < opts.arriveRadius * 1.5 && e.state.vel.length() > AI.ARRIVE_DRIFT ? 1 : 0
  return distance
}

/** Стоять: ни газа, ни рулей; остаточный ход гасим ретро-тягой, чтобы «стоять» не значило дрейфовать. */
export function holdStill(e: ShipEntity, killDrift: boolean): void {
  const c = e.controls
  c.throttle = 0
  c.pitch = 0
  c.yaw = 0
  c.roll = 0
  c.rudder = 0
  c.strafe = 0
  c.strafeUp = 0
  c.retro = killDrift && e.state.vel.length() > 2 ? 1 : 0
  c.boost = 1
  c.flightAssist = true
}
