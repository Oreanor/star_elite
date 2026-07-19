import { Vector3 } from 'three'
import { LINKED_PORTAL } from '../../config/galaxy'
import { effectiveRadius } from '../scale/scale'
import type { JumpGate, ShipEntity } from '../world/entities'

const RESTITUTION = 0.55
const _rel = new Vector3()
const _radial = new Vector3()
const _nearest = new Vector3()
const _normal = new Vector3()

/** Предельный осевой радиус: чистый проход задаётся в диаметрах корпуса конфигом. */
export function linkedPortalTargetRadius(ship: ShipEntity): number {
  return effectiveRadius(ship) * LINKED_PORTAL.CLEAR_DIAMETERS + LINKED_PORTAL.TUBE
}

/** Устье не должно возникать вплотную ни к малому, ни к крупному корпусу. */
export function linkedPortalAhead(ship: ShipEntity): number {
  return Math.max(LINKED_PORTAL.AHEAD_MIN, effectiveRadius(ship) * LINKED_PORTAL.AHEAD_RADII)
}

/** Один детерминированный шаг раскрытия/сжатия; направление задаёт контроллер. */
export function stepLinkedPortalRadius(
  radius: number,
  target: number,
  direction: 1 | -1,
  held: boolean,
  dt: number,
): number {
  if (!held) return radius
  const next = radius + direction * (target / LINKED_PORTAL.OPEN_SECONDS) * dt
  const clamped = Math.max(0, Math.min(target, next))
  if (direction < 0 && clamped <= target * LINKED_PORTAL.CLOSE_FRACTION) return 0
  return clamped
}

/** Знаковое расстояние центра корабля до плоскости устья. */
export function jumpGateSide(ship: ShipEntity, gate: JumpGate): number {
  _rel.copy(ship.state.pos).sub(gate.pos)
  return _rel.dot(gate.normal)
}

/** Весь корпус проходит внутри отверстия, не задевая твёрдую трубу. */
export function fitsInsideJumpGate(ship: ShipEntity, gate: JumpGate): boolean {
  _rel.copy(ship.state.pos).sub(gate.pos)
  const side = _rel.dot(gate.normal)
  const radialSq = Math.max(0, _rel.lengthSq() - side * side)
  const clearRadius = Math.max(0, gate.radius - gate.tube - effectiveRadius(ship))
  return radialSq <= clearRadius * clearRadius
}

/** Пересечение двустороннее: знак плоскости может смениться в любом направлении. */
export function crossedJumpGate(previousSide: number | null, side: number, fits: boolean): boolean {
  if (previousSide === null || !fits) return false
  return (previousSide <= 0 && side > 0) || (previousSide >= 0 && side < 0)
}

/**
 * Безопасный отскок от твёрдой трубы портала. Внутри тора пусто: пересечение
 * плоскости через отверстие сюда вообще не попадает и остаётся гиперпереходом.
 */
export function stepJumpGateCollision(ship: ShipEntity, gate: JumpGate): void {
  _rel.copy(ship.state.pos).sub(gate.pos)
  const axial = _rel.dot(gate.normal)
  _radial.copy(_rel).addScaledVector(gate.normal, -axial)
  const radialLength = _radial.length()
  if (radialLength < 1e-9) return

  // Ближайшая точка осевой окружности тора.
  _nearest.copy(gate.pos).addScaledVector(_radial, gate.radius / radialLength)
  _normal.copy(ship.state.pos).sub(_nearest)
  const distance = _normal.length()
  const reach = gate.tube + effectiveRadius(ship)
  if (distance >= reach) return

  if (distance < 1e-9) _normal.copy(_radial).normalize()
  else _normal.multiplyScalar(1 / distance)
  ship.state.pos.copy(_nearest).addScaledVector(_normal, reach)

  const closing = ship.state.vel.dot(_normal)
  if (closing < 0) ship.state.vel.addScaledVector(_normal, -(1 + RESTITUTION) * closing)
  ship.cruise.factor = 1
}
