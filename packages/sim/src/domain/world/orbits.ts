import { Vector3 } from 'three'
import type { BodyEntity, World } from './entities'

/**
 * Обращение спутников.
 *
 * Положение НЕ накапливается по кадрам: угол — это `phase + rate·time`, и точка
 * считается из него заново каждый шаг. Накопление зависело бы от частоты шага,
 * не пережило бы паузу и разошлось бы на двух машинах — а луна обязана висеть
 * там же и у сервера. Заодно это бесплатно чинит плавающее начало координат:
 * спутник считается ОТ ПЛАНЕТЫ, а её мир двигает сам.
 *
 * Планеты вокруг звезды не обращаются, и это осознанно: год у настоящей планеты
 * длится годы, а перелёт занимает минуты. Двигать её на угловую секунду за партию
 * значило бы платить за то, чего никто не увидит.
 */

const _radial = /* @__PURE__ */ new Vector3()
const _out = /* @__PURE__ */ new Vector3()

/**
 * Точка на наклонной круговой орбите. Наклон берётся вокруг оси X: орбита при
 * нулевом наклоне лежит в плоскости XZ — там же, где эклиптика системы.
 */
export function orbitPoint(body: BodyEntity, parent: BodyEntity, time: number, out: Vector3): Vector3 {
  const orbit = body.orbit
  if (!orbit) return out.copy(body.pos)

  const angle = orbit.phase + orbit.rate * time
  _radial.set(Math.cos(angle) * orbit.radius, 0, Math.sin(angle) * orbit.radius)

  const cos = Math.cos(orbit.tilt)
  const sin = Math.sin(orbit.tilt)
  _out.set(_radial.x, _radial.z * sin, _radial.z * cos)

  return out.copy(parent.pos).add(_out)
}

/** Расставить спутники по их орбитам на момент `world.time`. */
export function stepOrbits(world: World): void {
  for (const body of world.bodies) {
    if (!body.orbit) continue
    const parent = world.bodies.find((b) => b.id === body.orbit!.parentId)
    // Планету могло не оказаться только в кривых данных: молча оставляем на месте.
    if (parent) orbitPoint(body, parent, world.time, body.pos)
  }
}
