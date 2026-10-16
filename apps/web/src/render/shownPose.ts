import { Quaternion, Vector3 } from 'three'
import { gunQuat, renderPos, renderQuat, type ShipEntity, type World } from '@elite/sim'

const _q = new Quaternion()
const _p = new Vector3()

/**
 * Точка, ПРИКРЕПЛЁННАЯ к кораблю (дуло, сопло, крепление луча), там, где корабль ПОКАЗАН в
 * этом кадре — между тактами, см. `poseTrail`. Вспышка у дула, посчитанная по голой позе
 * такта, отставала бы от нарисованного корпуса на 144 Гц и «отклеивалась» от ствола.
 * Смещение — в связанных осях корабля.
 */
export function shownShipPoint(world: World, ship: ShipEntity, ox: number, oy: number, oz: number, out: Vector3): Vector3 {
  shownShipQuat(world, ship, _q)
  renderPos(world, ship.state, _p)
  return out.set(ox, oy, oz).applyQuaternion(_q).add(_p)
}

const _rq = new Quaternion()

/**
 * Поза корабля НА ВИД: между тактами и с наклоном за прицелом над поверхностью (`gunQuat`) —
 * корпус, факелы и точки на нём (дула, вспышки) рисуются в ней, чтобы лучи выходили соосно
 * фюзеляжу, а не били вниз из-под ровного брюха.
 */
export function shownShipQuat(world: World, ship: ShipEntity, out: Quaternion): Quaternion {
  renderQuat(world, ship.state, _rq)
  return gunQuat(_rq, ship.controls.aimPitch, out)
}
