import { Vector3 } from 'three'
import { IMPACT } from '../../config/weapons'
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
