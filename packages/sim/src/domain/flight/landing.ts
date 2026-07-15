import { Matrix4, Quaternion, Vector3 } from 'three'
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
const _targetQuat = /* @__PURE__ */ new Quaternion()

export function isLandable(body: BodyEntity): boolean {
  return body.kind === 'planet' || body.kind === 'moon'
}

/** Высота корабля над поверхностью тела, м (габарит борта учтён). Может быть отрицательной. */
export function surfaceAltitude(ship: ShipEntity, body: BodyEntity): number {
  return ship.state.pos.distanceTo(body.pos) - body.radius - effectiveRadius(ship)
}

/** Ближайшее посадочное тело и высота над ним; null — таких рядом нет. */
export function nearestLandable(
  world: World,
  ship: ShipEntity,
): { body: BodyEntity; altitude: number } | null {
  let best: { body: BodyEntity; altitude: number } | null = null
  for (const body of world.bodies) {
    if (!isLandable(body)) continue
    const altitude = surfaceAltitude(ship, body)
    if (best === null || altitude < best.altitude) best = { body, altitude }
  }
  return best
}

/**
 * В окне ли высот для автопосадки: игрок жив, не сидит и не садится, и до поверхности
 * ближайшего тела от PROMPT_LO до PROMPT_HI. Это же условие показывает пуш-подсказку —
 * подсказка и возможность нажать существуют ровно одновременно.
 */
export function canAutoland(world: World): boolean {
  const p = world.player
  if (!p.alive || p.landedOn || p.autoland !== null) return false
  const near = nearestLandable(world, p)
  if (!near) return false
  return near.altitude <= LANDING.PROMPT_HI && near.altitude >= LANDING.PROMPT_LO
}

/** Включить непрерываемую автопосадку игрока на ближайшее тело, если он в окне. */
export function armAutoland(world: World): boolean {
  if (!canAutoland(world)) return false
  world.player.autoland = nearestLandable(world, world.player)!.body.id
  return true
}

/**
 * Шаг НЕПРЕРЫВАЕМОЙ автопосадки. Пока стоит `ship.autoland`, ведём корабль вниз сами:
 * управляемый сход вдоль нормали (без инерции), плавный доворот корпуса в касательную;
 * у самой поверхности фиксируем посадкой. true — этот шаг ведём мы, интегратор и
 * гравитацию звать не надо (ввод игрока при этом ни на что не влияет — оттого непрерываемо).
 */
export function stepAutoland(ship: ShipEntity, world: World, dt: number): boolean {
  if (ship.autoland === null) return false
  const body = world.bodies.find((candidate) => candidate.id === ship.autoland)
  if (!body || !isLandable(body)) {
    ship.autoland = null
    return false
  }

  _normal.copy(ship.state.pos).sub(body.pos)
  if (_normal.lengthSq() < 1e-9) _normal.set(0, 1, 0)
  _normal.normalize()

  const altitude = surfaceAltitude(ship, body)
  if (altitude <= LANDING.CONTACT_GAP) {
    landShip(ship, body) // ровняет, стопорит, ставит landedOn
    ship.autoland = null
    return true
  }

  // Управляемый сход вдоль нормали: без инерции, шаг ограничен остатком высоты.
  const drop = Math.min(LANDING.DESCENT_SPEED * dt, altitude - LANDING.CONTACT_GAP)
  ship.state.pos.addScaledVector(_normal, -drop)
  ship.state.vel.set(0, 0, 0)
  ship.state.angVel.set(0, 0, 0)
  ship.controls.throttle = 0

  // Плавный доворот в касательную — та же поза, что даст landShip, но не рывком.
  shipAxes(ship.state.quat, _forward, _right, _up)
  _forward.addScaledVector(_normal, -_forward.dot(_normal))
  if (_forward.lengthSq() < 1e-9) {
    _forward.set(0, 1, 0)
    if (Math.abs(_forward.dot(_normal)) > 0.9) _forward.set(1, 0, 0)
    _forward.addScaledVector(_normal, -_forward.dot(_normal))
  }
  _forward.normalize()
  _right.crossVectors(_forward, _normal).normalize()
  _back.copy(_forward).negate()
  _targetQuat.setFromRotationMatrix(_basis.makeBasis(_right, _normal, _back)).normalize()
  ship.state.quat.slerp(_targetQuat, Math.min(1, LANDING.LEVEL_RATE * dt))

  return true
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
