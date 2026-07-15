import { Matrix4, Vector3 } from 'three'
import { LANDING } from '../../config/landing'
import { effectiveRadius } from '../scale/scale'
import type { BodyEntity, ShipEntity, World } from '../world/entities'
import { shipAxes } from './axes'

const _normal = /* @__PURE__ */ new Vector3()
const _forward = /* @__PURE__ */ new Vector3()
const _right = /* @__PURE__ */ new Vector3()
const _up = /* @__PURE__ */ new Vector3()
const _back = /* @__PURE__ */ new Vector3()
const _basis = /* @__PURE__ */ new Matrix4()

export function isLandable(body: BodyEntity): boolean {
  return body.kind === 'planet' || body.kind === 'moon'
}

/** Положить корпус касательно к сфере и остановить его без урона. */
export function landShip(ship: ShipEntity, body: BodyEntity): boolean {
  if (!ship.alive || !isLandable(body)) return false

  shipAxes(ship.state.quat, _forward, _right, _up)
  _normal.copy(ship.state.pos).sub(body.pos)
  if (_normal.lengthSq() < 1e-9) _normal.copy(_up)
  _normal.normalize()

  // Сохраняем направление носа, но убираем радиальную составляющую: корпус ложится
  // в касательную плоскость, а не втыкается носом в грунт.
  _forward.addScaledVector(_normal, -_forward.dot(_normal))
  if (_forward.lengthSq() < 1e-9) {
    _forward.set(0, 1, 0)
    if (Math.abs(_forward.dot(_normal)) > 0.9) _forward.set(1, 0, 0)
    _forward.addScaledVector(_normal, -_forward.dot(_normal))
  }
  _forward.normalize()
  _right.crossVectors(_forward, _normal).normalize()
  _back.copy(_forward).negate()
  ship.state.quat.setFromRotationMatrix(_basis.makeBasis(_right, _normal, _back)).normalize()

  ship.landedOn = { bodyId: body.id, normal: _normal.clone() }
  ship.state.pos.copy(body.pos).addScaledVector(_normal, body.radius + effectiveRadius(ship))
  ship.state.vel.set(0, 0, 0)
  ship.state.angVel.set(0, 0, 0)
  ship.controls.throttle = 0
  ship.controls.retro = 0
  ship.cruise.factor = 1
  ship.cruise.block = null
  ship.cruise.engaged = false
  ship.controls.cruise = 1
  return true
}

/**
 * Удержать корабль на движущейся поверхности. true означает, что обычную
 * гравитацию и интегратор в этом шаге вызывать не надо.
 */
export function stepLanding(ship: ShipEntity, world: World): boolean {
  const binding = ship.landedOn
  if (!binding) return false

  const body = world.bodies.find((candidate) => candidate.id === binding.bodyId)
  if (!body || !isLandable(body)) {
    ship.landedOn = null
    return false
  }

  const normal = binding.normal
  if (ship.controls.throttle > LANDING.TAKEOFF_THROTTLE) {
    // `stepOrbits` уже переносит игрока вместе с ближайшим телом, поэтому здесь
    // нужна только локальная скорость отрыва, без многокилометровой орбитальной.
    ship.state.vel.copy(normal).multiplyScalar(LANDING.TAKEOFF_SPEED)
    ship.state.pos.copy(body.pos).addScaledVector(
      normal,
      body.radius + effectiveRadius(ship) + LANDING.RELEASE_GAP,
    )
    ship.landedOn = null
    return false
  }

  ship.state.pos.copy(body.pos).addScaledVector(normal, body.radius + effectiveRadius(ship))
  ship.state.vel.set(0, 0, 0)
  ship.state.angVel.set(0, 0, 0)
  return true
}
