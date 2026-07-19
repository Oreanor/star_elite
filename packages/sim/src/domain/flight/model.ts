import { Quaternion, Vector3 } from 'three'
import { PHYSICS } from '../../config/physics'
import { approach, damp } from '../../core/math'
import { speedScaleFactor } from '../scale/scale'
import { shipAxes } from './axes'
import type { ShipControls, ShipState, ShipTuning } from './types'

/**
 * Шаг физики корабля. Один и тот же для игрока и бота — различаются только ShipControls.
 *
 * Модель намеренно двухслойная:
 *   • честная динамика — импульс, угловая инерция, свободный дрейф;
 *   • «гуманный» слой поверх — flight assist, который можно выключить,
 *     получив чистый Ньютон.
 *
 * Ни один слой не знает, где в мире «верх». Вращение считается только в связанных
 * осях: корабль ведёт себя одинаково, вися вверх ногами и носом к звезде.
 */

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _accel = new Vector3()
const _lateral = new Vector3()
const _alongNose = new Vector3()
const _omega = new Vector3()
const _targetAng = new Vector3()
const _dq = new Quaternion()

export function stepShip(s: ShipState, c: ShipControls, t: ShipTuning, dt: number): void {
  integrateAngular(s, c, t, dt)
  integrateLinear(s, c, t, dt)
}

function integrateAngular(s: ShipState, c: ShipControls, t: ShipTuning, dt: number): void {
  // Ручка задаёт ЖЕЛАЕМУЮ угловую скорость, а не угол.
  // +Y в связанных осях уводит нос влево — отсюда минус у рыскания.
  _targetAng.set(
    c.pitch * t.PITCH_RATE,
    -(c.yaw + c.rudder) * t.YAW_RATE,
    0,
  )

  _targetAng.z = desiredRollRate(c, t)

  // Разгон угловой скорости ограничен угловым ускорением — отсюда инерция носа.
  s.angVel.x = approach(s.angVel.x, _targetAng.x, t.PITCH_ACCEL * dt)
  s.angVel.y = approach(s.angVel.y, _targetAng.y, t.YAW_ACCEL * dt)
  s.angVel.z = approach(s.angVel.z, _targetAng.z, t.ROLL_ACCEL * dt)

  // В вакууме нечему гасить вращение, но без стабилизации корабль неуправляем.
  // Трактуем как работу маневровых двигателей, а не как аэродинамику.
  if (c.pitch === 0 && c.yaw === 0 && c.rudder === 0) {
    s.angVel.x = damp(s.angVel.x, t.ANG_DAMP, dt)
    s.angVel.y = damp(s.angVel.y, t.ANG_DAMP, dt)
  }

  // Угловая скорость задана в СВЯЗАННЫХ осях, поэтому приращение умножается СПРАВА.
  _omega.copy(s.angVel).multiplyScalar(dt)
  const angle = _omega.length()
  if (angle > 1e-9) {
    _dq.setFromAxisAngle(_omega.divideScalar(angle), angle)
    s.quat.multiply(_dq).normalize()
  }
}

/**
 * Крен задаёт только пилот. Никакой автокоординации.
 *
 * Раньше здесь жил ПД-регулятор, тянувший крен к «горизонту» мировой оси Y.
 * В вакууме такой оси нет: она бралась из головы, и корабль послушно
 * подкручивался к ней сам, стоило отпустить ручку. Хуже того, замыкался контур
 * крен → тангаж → `bankAuthority` → крен, и в затяжном вираже корабль качало.
 *
 * Теперь физика вращения ИНВАРИАНТНА К ОРИЕНТАЦИИ: одни и те же органы
 * управления дают одну и ту же угловую скорость в связанных осях, где бы нос
 * ни смотрел. Ровно этого и ждёшь от корабля в невесомости — и ровно это
 * позволит однажды сверить симуляцию с сервером, не сверяя «где верх».
 */
function desiredRollRate(c: ShipControls, t: ShipTuning): number {
  return c.roll * t.ROLL_RATE
}

function integrateLinear(s: ShipState, c: ShipControls, t: ShipTuning, dt: number): void {
  shipAxes(s.quat, _fwd, _right, _up)

  // Ручник (Ctrl): гасит ВЕСЬ вектор скорости. Раньше здесь была ретро-тяга вдоль носа —
  // на ×scale / крейсере она не успевала, и борт «куда-то летел» даже на нулевом газе.
  if (c.retro > 0) {
    // Сбрасываем газ в controls: иначе после отпускания ручника FA тянет к старому
    // commanded = throttle×scale и корабль «выстреливает». Пилот/ИИ заново дадут газ.
    c.throttle = 0
    const grow = speedScaleFactor(s.scale)
    s.vel.multiplyScalar(Math.exp(-PHYSICS.HANDBRAKE_RATE * c.retro * dt))
    // Добиваем в ноль ниже 0.1% потолка текущего масштаба — иначе хвост экспоненты
    // на гигаметрах/с висит секундами.
    const stopAt = Math.max(1, t.MAX_SPEED * grow * 0.001)
    if (s.vel.lengthSq() < stopAt * stopAt) s.vel.set(0, 0, 0)
    s.pos.addScaledVector(s.vel, dt)
    return
  }

  // Форсаж и крейсер — просто множители. Интегратор не знает, что это «режимы».
  // Миелофон поднимает тягу и потолок вместе с размером: иначе гигант ползёт как истребитель.
  const power = c.boost * c.cruise
  const grow = speedScaleFactor(s.scale)

  const thrust = c.throttle * t.THRUST * power * grow
  _accel.copy(_fwd).multiplyScalar(thrust / t.MASS)

  // Поперечная тяга маневровых. Форсаж её не касается: это другие двигатели.
  const lateral = Math.hypot(c.strafe, c.strafeUp)
  if (lateral > 1e-6) {
    // Зажимаем в круг, а не в квадрат: по диагонали тяга не должна быть больше.
    const scale = (t.STRAFE_THRUST * grow) / (t.MASS * Math.max(1, lateral))
    _accel.addScaledVector(_right, c.strafe * scale)
    _accel.addScaledVector(_up, c.strafeUp * scale)
  }

  s.vel.addScaledVector(_accel, dt)

  if (c.flightAssist) applyFlightAssist(s, c, t, dt)

  // Абсолютный потолок: иначе тяга уводит скорость в бесконечность.
  const cap = t.MAX_SPEED * power * grow
  const speed = s.vel.length()
  if (speed > cap) s.vel.multiplyScalar(cap / speed)

  s.pos.addScaledVector(s.vel, dt)
}

/**
 * Flight assist гасит снос — составляющую скорости поперёк носа — и тянет
 * продольную скорость к командной. Выключи его, и корабль полетит как в Elite:
 * нос смотрит куда угодно, а вектор скорости живёт своей жизнью.
 */
function applyFlightAssist(s: ShipState, c: ShipControls, t: ShipTuning, dt: number): void {
  const along = s.vel.dot(_fwd)

  // Пока жмут поперечную тягу, снос не гасим: компьютер держит то, что ему скомандовали.
  // Иначе ассист съедал бы «бочку» ровно с той же силой, с какой её создают маневровые.
  if (c.strafe === 0 && c.strafeUp === 0) {
    _alongNose.copy(_fwd).multiplyScalar(along)
    _lateral.copy(s.vel).sub(_alongNose)
    s.vel.addScaledVector(_lateral, -Math.min(1, t.ASSIST_LATERAL_DAMP * dt))
  }

  // Без этого корабль разгонялся бы вечно, пока есть тяга.
  // Командная скорость — доля газа от потолка текущего масштаба (× speedScaleFactor).
  const grow = speedScaleFactor(s.scale)
  const commanded = c.throttle * t.MAX_SPEED * c.boost * c.cruise * grow
  const coasting =
    c.throttle === 0 && c.retro === 0 && c.strafe === 0 && c.strafeUp === 0
  // На выбеге — COAST_RATE: иначе ASSIST_SPEED_DAMP оставляет гиганта «плыть» минуту.
  const speedDamp = coasting ? Math.max(t.ASSIST_SPEED_DAMP, PHYSICS.COAST_RATE) : t.ASSIST_SPEED_DAMP
  const corrected = along + (commanded - along) * Math.min(1, speedDamp * dt)
  s.vel.addScaledVector(_fwd, corrected - along)

  // Нулевой газ: режем хвост относительно потолка ×scale (как ручник), не абсолютные 0.5 м/с.
  if (coasting) {
    const stopAt = Math.max(0.5, t.MAX_SPEED * grow * 0.001)
    if (s.vel.lengthSq() < stopAt * stopAt) s.vel.set(0, 0, 0)
  }
}
