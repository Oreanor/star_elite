import { Vector3 } from 'three'
import { AI } from '../../config/ai'
import { clamp } from '../../core/math'
import { bankToward, steerToward } from '../flight/steering'
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
}

const DEFAULTS: DriveOptions = { throttle: 1, boost: 1, arriveRadius: null, avoid: true, separate: true }
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

  // Ловкость пилота — крутизна руля, а не потолок: команды обрезаются в [−1, 1], поэтому
  // угловая скорость у ловкого та же, что у любого, — он лишь раньше выходит на упор.
  const gain = AI.STEER_GAIN * pilotTraits(e).reflex
  steerToward(e.state, _steerAim, gain, _steer)
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
