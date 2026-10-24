import { Quaternion, Vector3, type Object3D } from 'three'
import { COSMIC, PHYSICS, aimDirection, chargeBallCenter, chargeBallRadius, renderPos, type ShipEntity, type World } from '@elite/sim'
import { GIANT_RENDER_CAP } from '../config'
import { shownShipQuat } from '../shownPose'

/**
 * Поза ЗАРЯДА космического импульса перед носом и летящего импульса между тактами — общая
 * для обоих видов (шар разбивающего, точка импульса жизни): одна формула места, иначе выстрел
 * отрывался бы не оттуда, где висел заряд.
 */

const _shipAt = new Vector3()
const _shipQ = new Quaternion()
const _aim = new Vector3()

/**
 * Заряд корабля в `dummy` (позиция и масштаб — радиус ядра). false — заряда нет. Свой корпус на
 * экране зажат потолком (`GIANT_RENDER_CAP`) — и заряд тем же множителем, иначе гигант держал
 * бы перед носом шар больше себя. Готовый шар дрожит: энергия на пределе.
 */
export function placeCharge(world: World, ship: ShipEntity, now: number, clock: number, dummy: Object3D): boolean {
  const r = chargeBallRadius(ship, now)
  if (r <= 0) return false
  const scale = ship.state.scale
  const shown = ship === world.player ? Math.min(scale, GIANT_RENDER_CAP) / scale : 1
  renderPos(world, ship.state, _shipAt)
  shownShipQuat(world, ship, _shipQ)
  aimDirection(_shipQ, 0, _aim)
  // Готовый ШАР дрожит размером; у точки жизни своё мерцание в шейдере — дрожь её дёргала.
  const c = ship.pulseCharge
  const ready = c?.kind === 'shatter' && c.level === 1 && c.cancelledAt === null
  // Центр — по радиусу без таяния: отменённый заряд гаснет на месте, а не уезжает к носу.
  chargeBallCenter(_shipAt, _aim, ship.spec.hull.radius * scale * shown, chargeBallRadius(ship, now, false) * shown, dummy.position)
  dummy.scale.setScalar(r * shown * (ready ? 1 + 0.05 * Math.sin(clock * 37) : 1))
  return true
}

/**
 * Радиус ПОЛНОГО заряда на экране, м: тот, до которого он дорастёт. По нему меряют то, что
 * не должно расти с зарядом с нуля (поле втягиваемых штрихов импульса жизни).
 */
export function chargeFullRadius(world: World, ship: ShipEntity): number {
  const scale = ship.state.scale
  const shown = ship === world.player ? Math.min(scale, GIANT_RENDER_CAP) / scale : 1
  const size = ship.pulseCharge?.kind === 'seed' ? COSMIC.CHARGE_SEED : COSMIC.CHARGE_BALL
  return ship.spec.hull.radius * scale * shown * size
}

/** Импульс между тактами: такт ушёл вперёд на долю шага — откатываем по скорости. */
export function shownPulse(world: World, pos: Vector3, vel: Vector3, out: Vector3): Vector3 {
  return out.copy(pos).addScaledVector(vel, -(1 - world.renderAlpha) * PHYSICS.FIXED_DT)
}
