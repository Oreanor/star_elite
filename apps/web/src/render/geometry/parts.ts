import { quad, tri, type Triangle, type Vec3 } from './build'

/**
 * Мелкие детали, из которых собираются корабли: расшивка, лючки, сопла,
 * стволы, пилоны, антенны.
 *
 * Отдельный модуль, потому что у него своя причина меняться: силуэт корабля
 * и его обвес живут разной жизнью. Здесь нет ни одного корабля — только детали.
 *
 * Всё возвращает треугольники и ничего не знает про three: геометрию собирает
 * `buildGeometry`, один раз на модуль.
 */

/**
 * Накладка поверх грани: лючок или полоса расшивки.
 *
 * Приподнимается над несущей гранью на `lift`, иначе буфер глубины выберет
 * победителя случайно и панель замерцает. Приподнимаем, а не утапливаем:
 * утопленная панель на выпуклом корпусе проваливается внутрь.
 */
export function panel(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: number, lift: Vec3): Triangle[] {
  const up = (v: Vec3): Vec3 => [v[0] + lift[0], v[1] + lift[1], v[2] + lift[2]]
  return quad(up(a), up(b), up(c), up(d), color)
}

/** Прямоугольный брус вдоль Z. Ствол орудия, пилон, стойка. */
export function beam(
  x0: number, x1: number,
  y0: number, y1: number,
  z0: number, z1: number,
  color: number,
): Triangle[] {
  const p: Vec3[] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ]
  const v = (i: number): Vec3 => p[i]!
  return [
    ...quad(v(0), v(1), v(2), v(3), color), // передний торец
    ...quad(v(5), v(4), v(7), v(6), color), // задний
    ...quad(v(4), v(0), v(3), v(7), color), // левый борт
    ...quad(v(1), v(5), v(6), v(2), color), // правый
    ...quad(v(3), v(2), v(6), v(7), color), // верх
    ...quad(v(4), v(5), v(1), v(0), color), // низ
  ]
}

/**
 * Сопло-колокол, раструбом назад (+Z). Горловина у `z`, срез у `z + length`.
 *
 * Жерло — светлый диск ВНУТРИ колокола, а не эмиссия: материал корпуса не
 * эмиссивный, и заводить ради четырёх сопел второй — значит платить лишним
 * draw call за то, что видно секунду при развороте.
 */
export function bell(
  cx: number, cy: number, cz: number,
  throatRadius: number,
  mouthRadius: number,
  length: number,
  segments: number,
  wall: number,
  core: number,
): Triangle[] {
  const out: Triangle[] = []
  const ring = (radius: number, z: number, i: number): Vec3 => {
    const a = (i / segments) * Math.PI * 2
    return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, z]
  }

  const mouthZ = cz + length
  const coreZ = cz + length * 0.3
  const coreCentre: Vec3 = [cx, cy, coreZ]

  for (let i = 0; i < segments; i++) {
    out.push(...quad(ring(throatRadius, cz, i), ring(mouthRadius, mouthZ, i), ring(mouthRadius, mouthZ, i + 1), ring(throatRadius, cz, i + 1), wall))
    // Диск жерла: веер из центра, виден только если смотришь кораблю в корму.
    out.push(tri(coreCentre, ring(throatRadius * 0.92, coreZ, i), ring(throatRadius * 0.92, coreZ, i + 1), core))
  }
  return out
}

/**
 * Тонкая пластина-антенна в плоскости, параллельной борту (x = const).
 * Один треугольник: материал двусторонний, и лишняя грань тут ничего не добавит.
 */
export function antenna(x: number, base: readonly [number, number], tip: readonly [number, number], color: number): Triangle[] {
  const [z0, y0] = base
  const [z1, y1] = tip
  return [tri([x, y0, z0], [x, y0, z0 + 0.9], [x, y1, z1], color)]
}
