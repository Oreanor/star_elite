import { Vector3 } from 'three'
import { LINKED_PORTAL } from '../../config/galaxy'
import { effectiveRadius } from '../scale/scale'
import type { JumpGate, ShipEntity } from '../world/entities'

const RESTITUTION = 0.55
const _rel = new Vector3()
const _radial = new Vector3()
const _nearest = new Vector3()
const _normal = new Vector3()
const _cross = new Vector3()

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

/** Место корабля относительно центра устья — в `out`. Хранят его от шага к шагу (`crossedJumpGate`). */
export function jumpGateRel(ship: ShipEntity, gate: JumpGate, out: Vector3): Vector3 {
  return out.copy(ship.state.pos).sub(gate.pos)
}

/**
 * Прошёл ли корпус СКВОЗЬ отверстие за шаг — от прежнего места `prevRel` (относительно устья,
 * `jumpGateRel`) к нынешнему. Пересечение двустороннее: знак плоскости может смениться в любую
 * сторону. Вписанность меряется в ТОЧКЕ ПЕРЕСЕЧЕНИЯ плоскости, а не в конечной: на форсаже за
 * кадр корабль уходит на километры за кольцо, и наклон курса в пару градусов уводил конечную
 * точку мимо отверстия — переход терялся, корабль проскакивал кольцо насквозь.
 */
export function crossedJumpGate(prevRel: Vector3 | null, ship: ShipEntity, gate: JumpGate): boolean {
  if (!prevRel) return false
  _rel.copy(ship.state.pos).sub(gate.pos)
  const a = prevRel.dot(gate.normal)
  const b = _rel.dot(gate.normal)
  if (!((a <= 0 && b > 0) || (a >= 0 && b < 0))) return false
  _cross.copy(prevRel).lerp(_rel, a === b ? 0 : a / (a - b))
  const axial = _cross.dot(gate.normal)
  const radialSq = Math.max(0, _cross.lengthSq() - axial * axial)
  const clearRadius = Math.max(0, gate.radius - gate.tube - effectiveRadius(ship))
  return radialSq <= clearRadius * clearRadius
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
