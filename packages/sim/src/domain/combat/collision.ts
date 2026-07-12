import { Vector3 } from 'three'
import { IMPACT } from '../../config/weapons'
import { SHIELD } from '../../config/station'
import type { ShipEntity } from '../world/entities'
import { applyDamage } from './damage'

const _delta = new Vector3()
const _normal = new Vector3()
const _relVel = new Vector3()

/**
 * Расталкивание корабля и сферического препятствия.
 *
 * Это не полноценная физика удара — тензора инерции здесь нет, вращение от
 * касательного удара не возникает. Но импульс по нормали честный, и урон
 * пропорционален скорости сближения: влететь в астероид на форсаже смертельно.
 *
 * @returns нанесённый кораблю урон.
 */
export function resolveShipVsSphere(
  ship: ShipEntity,
  otherPos: Vector3,
  otherVel: Vector3,
  otherRadius: number,
  otherMass: number,
  time: number,
): number {
  _delta.copy(ship.state.pos).sub(otherPos)
  const distance = _delta.length()
  const minDistance = ship.spec.hull.radius + otherRadius

  if (distance >= minDistance || distance < 1e-6) return 0

  _normal.copy(_delta).divideScalar(distance)

  // Сначала разводим по позиции, иначе тела залипнут и будут дрожать.
  ship.state.pos.addScaledVector(_normal, minDistance - distance)

  const closingSpeed = _relVel.copy(ship.state.vel).sub(otherVel).dot(_normal)
  if (closingSpeed >= 0) return 0 // уже расходятся

  // Доля импульса, достающаяся кораблю: лёгкий отлетает от тяжёлого.
  const massRatio = otherMass / (ship.spec.mass + otherMass)
  ship.state.vel.addScaledVector(_normal, -closingSpeed * (1 + IMPACT.RESTITUTION) * massRatio)

  const damage = Math.min(
    IMPACT.RAM_DAMAGE_MAX,
    Math.abs(closingSpeed) * IMPACT.RAM_DAMAGE_PER_SPEED,
  )
  if (damage > 1) {
    applyDamage(ship, damage, time)
    return damage
  }
  return 0
}

const _sdelta = new Vector3()
const _snormal = new Vector3()

/**
 * Отскок корабля от защитного поля станции. В отличие от удара о твердь — БЕЗ урона:
 * поле упруго отталкивает и ГАСИТ скорость (пружина, не таран). Врезаться в станцию
 * больше нельзя: разогнавшийся отпружинивает назад, теряя ход. Пропуск через поле —
 * забота вызывающего (идущему на стыковку с допуском поле не мешает).
 *
 * Кладёт точку контакта на сфере поля в `outContact` и ВОЗВРАЩАЕТ скорость сближения
 * в момент удара, м/с: `-1` — контакта не было; `0` — корабль касается, но лишь упирается/
 * скользит вдоль поля без налёта; `>0` — налетел с этой скоростью. Вызывающий по этому
 * числу задаёт ЯРКОСТЬ вспышки (упор — еле видно, таран — ярко), а не «есть/нет».
 */
export function bounceOffShield(
  ship: ShipEntity,
  center: Vector3,
  shieldRadius: number,
  outContact: Vector3,
): number {
  _sdelta.copy(ship.state.pos).sub(center)
  const distance = _sdelta.length()
  const minDistance = ship.spec.hull.radius + shieldRadius
  if (distance >= minDistance || distance < 1e-6) return -1

  _snormal.copy(_sdelta).divideScalar(distance)
  // Выталкиваем на поверхность поля: иначе корабль вязнет и дрожит в нём.
  ship.state.pos.addScaledVector(_snormal, minDistance - distance)

  // Точка контакта — на сфере поля, туда рендер положит голубой кружок.
  outContact.copy(center).addScaledVector(_snormal, shieldRadius)

  const closing = ship.state.vel.dot(_snormal)
  if (closing >= 0) return 0 // касается, но отходит/скользит — не удар, поле лишь мерцает

  // Отражаем нормальную составляющую с восстановлением < 1: корабль отпружинивает
  // назад, но медленнее, чем влетел. Касательную не трогаем — он скользит вдоль поля.
  ship.state.vel.addScaledVector(_snormal, -closing * (1 + SHIELD.BOUNCE))
  return -closing // скорость налёта на поле, м/с
}
