import { Vector3 } from 'three'
import { MIELOPHONE } from '../../config/mielophone'
import { warBaseSolidRadius } from '../flight/landing'
import type { ShipEntity, World } from '../world/entities'
import { bodyZoom, bodySizeFactor, effectiveRadius } from './scale'

/**
 * ЗАЗОР ПРИ СМЕНЕ РОСТА. Закон зума держит центры тел на месте, а размеры меняет: тело для
 * выросшего ужимается, корпус растёт. Сожмись у звезды — её видимая поверхность растёт быстрее,
 * чем ты к ней «приближаешься», и наезжает на корабль; подрасти у планеты — корпус дотянется до
 * неё сам. Прежде это было ударом о тело, до которого пилот не долетал. Теперь, если смена роста
 * свела зазор «край — край» под ноль, корабль мягко выталкивает наружу по линии «центр → борт»,
 * без удара и урона, и гасится лишь скорость ВНУТРЬ тела.
 *
 * Только твердь, что держит этот корпус (не мельче доли его радиуса, `SOLID_MIN_SHARE`), и только
 * ниже GHOST_BODY — выше тела сквозные. Станции не трогаем: у их поля своя логика допуска.
 */

const _out = new Vector3()

export function clearBodiesOnResize(world: World, ship: ShipEntity): void {
  const scale = ship.state.scale
  if (scale >= MIELOPHONE.GHOST_BODY_SCALE || ship.landedOn) return
  const shipR = effectiveRadius(ship)
  for (const body of world.bodies) {
    if (body.kind === 'blackhole' || body.kind === 'station') continue
    push(ship, body.pos, body.radius * bodyZoom(body, scale), shipR)
  }
  const k = bodySizeFactor(scale)
  for (const base of world.warBases) {
    if (base.alive) push(ship, base.pos, warBaseSolidRadius(base.radius) * k, shipR)
  }
}

function push(ship: ShipEntity, center: Vector3, radius: number, shipR: number): void {
  if (radius < shipR * MIELOPHONE.SOLID_MIN_SHARE) return
  const reach = radius + shipR
  _out.copy(ship.state.pos).sub(center)
  const d = _out.length()
  if (d >= reach) return
  if (d < 1e-6) _out.set(0, 1, 0)
  else _out.divideScalar(d)
  ship.state.pos.copy(center).addScaledVector(_out, reach * (1 + MIELOPHONE.RESIZE_CLEARANCE))
  // Скорость внутрь тела гасим: иначе следующий шаг снова вогнал бы корабль в поверхность.
  const inward = ship.state.vel.dot(_out)
  if (inward < 0) ship.state.vel.addScaledVector(_out, -inward)
}
