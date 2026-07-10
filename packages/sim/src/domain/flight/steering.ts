import { Quaternion, Vector3 } from 'three'
import { clamp, interceptTime } from '../../core/math'
import type { ShipState } from './types'

/**
 * Наведение. Возвращает те же pitch/yaw в [-1,1], что даёт мышь игрока —
 * поэтому бот физически не может обхитрить физику: он жмёт те же кнопки.
 */

const _toAim = new Vector3()
const _inv = new Quaternion()

export function steerToward(
  s: ShipState,
  aim: Vector3,
  gain = 2.4,
  out: { pitch: number; yaw: number } = { pitch: 0, yaw: 0 },
): { pitch: number; yaw: number } {
  _toAim.copy(aim).sub(s.pos)
  if (_toAim.lengthSq() < 1e-6) {
    out.pitch = 0
    out.yaw = 0
    return out
  }

  // Переводим направление на цель в связанные оси: там цель впереди — это (0,0,-1).
  _inv.copy(s.quat).invert()
  _toAim.normalize().applyQuaternion(_inv)

  out.pitch = clamp(Math.asin(clamp(_toAim.y, -1, 1)) * gain, -1, 1)
  out.yaw = clamp(Math.atan2(_toAim.x, -_toAim.z) * gain, -1, 1)
  return out
}

/** Ниже этого отклонения от носа крен не нужен: цель и так почти в прицеле. */
const BANK_MIN_OFFSET = 0.05

/**
 * Крен «в цель»: катим корабль так, чтобы цель ушла в плоскость ТАНГАЖА.
 *
 * Тангаж быстрее рыскания (1.33 против 0.77 рад/с) — маневровые носа и хвоста
 * плечистее бортовых. Поэтому разворачиваться выгодно не рулём, а креном:
 * повернул корабль вокруг носа, и цель оказалась «сверху», где её достаёт
 * быстрая ось. Именно так летают живые пилоты, и ровно это раньше делала за
 * бота автокоординация — пока не выяснилось, что она тянет крен к мировой оси.
 *
 * Мирового «верха» здесь нет: крен считается ОТНОСИТЕЛЬНО ЦЕЛИ, в связанных осях.
 *
 * @returns команда крена в [-1,1], та же, что даёт клавиша A/D у игрока.
 */
export function bankToward(s: ShipState, aim: Vector3, gain = 1.6): number {
  _toAim.copy(aim).sub(s.pos)
  if (_toAim.lengthSq() < 1e-6) return 0

  _inv.copy(s.quat).invert()
  _toAim.normalize().applyQuaternion(_inv)

  // Проекция направления на цель в плоскость, поперечную носу.
  const offset = Math.hypot(_toAim.x, _toAim.y)
  if (offset < BANK_MIN_OFFSET) return 0

  /**
   * Угол от «верха» корабля до цели, по часовой. Крен идёт вокруг связанной Z,
   * а она смотрит НАЗАД (нос в −Z), поэтому положительная команда крена уводит
   * цель по часовой — знак берём обратный, чтобы гнать её вверх, а не вниз.
   */
  const phi = Math.atan2(_toAim.x, _toAim.y)

  // Плавно у самого прицела: иначе бот дрожит креном, когда цель уже по курсу.
  const authority = Math.min(1, (offset - BANK_MIN_OFFSET) / 0.2)
  return clamp(-phi * gain * authority, -1, 1)
}

const _relPos = new Vector3()
const _relVel = new Vector3()

/**
 * Точка упреждения: куда целиться, чтобы снаряд встретился с движущейся целью.
 *
 * Для мгновенного луча это вырождается в саму цель — поэтому бот использует
 * конечную «скорость снаряда» как горизонт упреждения. Иначе он вечно отстаёт
 * от цели ровно на своё время разворота.
 */
export function interceptPoint(
  shooterPos: Vector3,
  shooterVel: Vector3,
  targetPos: Vector3,
  targetVel: Vector3,
  projectileSpeed: number,
  out: Vector3,
): Vector3 {
  _relPos.copy(targetPos).sub(shooterPos)
  _relVel.copy(targetVel).sub(shooterVel)

  const t = interceptTime(_relPos, _relVel, projectileSpeed)
  if (t < 0) return out.copy(targetPos) // не догнать — целимся прямо

  return out.copy(targetVel).multiplyScalar(t).add(targetPos)
}
