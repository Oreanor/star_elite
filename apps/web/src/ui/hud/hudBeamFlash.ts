import { Vector3 } from 'three'
import { beamDirection, renderTime } from '@elite/sim'
import type { HudFrame } from './hudShared'

/**
 * ВСПЫШКА ЛУЧА — главный признак пульсара: когда луч маяка проходит через наблюдателя,
 * экран на миг засвечивает. По ней пульсар и узнаётся — импульсами, а не плавной развёрткой.
 * У джета квазара то же самое, только луч стоит: сидишь в нём — засветка держится (и корпус
 * калится — см. `beamExposure`).
 *
 * Направление луча — та же доменная формула (`beamDirection`) от показанного времени, что
 * у отрисовки лучей: вспышка совпадает с тем, что видно. Меряем от КАМЕРЫ — засвечивает
 * объектив, а не корпус. Конус берём по видимому ореолу, он шире опасной зоны.
 */

/** Во сколько раз видимый ореол луча шире опасной зоны (как внешний слой `StarBeams`). */
const HALO_WIDEN = 1.6
/** Наибольшая непрозрачность засветки — экран не выбеливается целиком, HUD читается. */
const FLASH_MAX = 0.75
const FLASH_RGB = '226, 244, 255'

const _r = new Vector3()
const _dir = new Vector3()

export function drawBeamFlash({ ctx, camera, world, width, height }: HudFrame): void {
  let strongest = 0
  const time = renderTime(world)
  for (const body of world.bodies) {
    const beams = body.beams
    if (!beams) continue
    _r.copy(camera.position).sub(body.pos)
    beamDirection(body, time, _dir)
    const along = _r.dot(_dir)
    const s = Math.abs(along)
    if (s < body.radius || s > beams.length) continue
    const perp = Math.sqrt(Math.max(0, _r.lengthSq() - along * along))
    const halo = (body.radius + s * Math.tan(beams.halfAngle)) * HALO_WIDEN
    // Квадрат — резкий пик у оси: вспышка, а не ровная подсветка всего конуса.
    const e = Math.max(0, 1 - perp / halo) ** 2 * (1 - s / beams.length)
    if (e > strongest) strongest = e
  }
  if (strongest < 0.01) return
  ctx.fillStyle = `rgba(${FLASH_RGB}, ${(strongest * FLASH_MAX).toFixed(3)})`
  ctx.fillRect(0, 0, width, height)
}
