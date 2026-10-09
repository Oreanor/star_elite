import { Quaternion, Vector3 } from 'three'
import { renderPos, renderQuat, type ShipEntity, type World } from '@elite/sim'

const _q = new Quaternion()
const _p = new Vector3()

/**
 * Точка, ПРИКРЕПЛЁННАЯ к кораблю (дуло, сопло, крепление луча), там, где корабль ПОКАЗАН в
 * этом кадре — между тактами, см. `poseTrail`. Вспышка у дула, посчитанная по голой позе
 * такта, отставала бы от нарисованного корпуса на 144 Гц и «отклеивалась» от ствола.
 * Смещение — в связанных осях корабля.
 */
export function shownShipPoint(world: World, ship: ShipEntity, ox: number, oy: number, oz: number, out: Vector3): Vector3 {
  renderQuat(world, ship.state, _q)
  renderPos(world, ship.state, _p)
  return out.set(ox, oy, oz).applyQuaternion(_q).add(_p)
}
