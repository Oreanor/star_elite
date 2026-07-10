import { Vector3 } from 'three'
import type { OrbitDef, World } from './entities'

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
 *
 * Звёзды двойной — обращаются: их период выводится из массы и выходит в дни, так
 * же незаметный за партию. Но пару можно ОБЛЕТЕТЬ, увидев два солнца с разных
 * сторон, и ради этого движение честное, а не назначенное.
 */

const _radial = /* @__PURE__ */ new Vector3()
const _out = /* @__PURE__ */ new Vector3()
const _bary = /* @__PURE__ */ new Vector3()

/**
 * Точка на наклонной круговой орбите вокруг `parentPos`. Наклон берётся вокруг
 * оси X: орбита при нулевом наклоне лежит в плоскости XZ — там же, где эклиптика.
 *
 * Родитель приходит ПОЗИЦИЕЙ, а не телом: у барицентра двойной звезды тела нет,
 * есть только точка. Это заодно и делает всё правильным при плавающем начале —
 * позицию родителя двигает мир, а орбита лишь добавляется к ней.
 */
export function orbitPoint(orbit: OrbitDef, parentPos: Vector3, time: number, out: Vector3): Vector3 {
  const angle = orbit.phase + orbit.rate * time
  _radial.set(Math.cos(angle) * orbit.radius, 0, Math.sin(angle) * orbit.radius)

  const cos = Math.cos(orbit.tilt)
  const sin = Math.sin(orbit.tilt)
  _out.set(_radial.x, _radial.z * sin, _radial.z * cos)

  return out.copy(parentPos).add(_out)
}

/**
 * Позиция барицентра системы в ЛОКАЛЬНЫХ координатах. Барицентр стоит в истинном
 * нуле мира; локальная = истинная − originOffset = −originOffset. Так двойная
 * звезда остаётся на месте относительно планет, куда бы ни уехало начало отсчёта.
 */
function barycentre(world: World): Vector3 {
  return _bary.set(0, 0, 0).sub(world.originOffset)
}

/** Расставить спутники и звёзды двойной по их орбитам на момент `world.time`. */
export function stepOrbits(world: World): void {
  for (const body of world.bodies) {
    const orbit = body.orbit
    if (!orbit) continue

    if (orbit.parentId === null) {
      orbitPoint(orbit, barycentre(world), world.time, body.pos)
      continue
    }
    const parent = world.bodies.find((b) => b.id === orbit.parentId)
    // Родителя могло не оказаться только в кривых данных: молча оставляем на месте.
    if (parent) orbitPoint(orbit, parent.pos, world.time, body.pos)
  }
}
