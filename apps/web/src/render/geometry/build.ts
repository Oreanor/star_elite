import { BufferAttribute, BufferGeometry, Color } from 'three'

/**
 * Сборка низкополигональных мешей из треугольников с покраской по вершинам.
 *
 * Геометрия НЕиндексированная: каждый треугольник несёт свои вершины.
 * Это ровно то, что нужно плоскому шейдингу — общие вершины усредняли бы нормали
 * и превратили бы грани в мыло. Заодно позволяет красить каждую грань отдельно.
 */

export type Vec3 = readonly [number, number, number]

export interface Triangle {
  a: Vec3
  b: Vec3
  c: Vec3
  color: number
}

/** Треугольник. Порядок вершин — против часовой стрелки при взгляде снаружи. */
export function tri(a: Vec3, b: Vec3, c: Vec3, color: number): Triangle {
  return { a, b, c, color }
}

/** Четырёхугольник как два треугольника. Вершины по кругу. */
export function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: number): Triangle[] {
  return [tri(a, b, c, color), tri(a, c, d, color)]
}

const _color = new Color()

export function buildGeometry(triangles: Triangle[]): BufferGeometry {
  const positions = new Float32Array(triangles.length * 9)
  const colors = new Float32Array(triangles.length * 9)

  triangles.forEach((t, i) => {
    const p = i * 9
    positions.set([...t.a, ...t.b, ...t.c], p)

    _color.setHex(t.color)
    // Один цвет на все три вершины: грань остаётся плоской.
    for (let v = 0; v < 3; v++) {
      colors[p + v * 3] = _color.r
      colors[p + v * 3 + 1] = _color.g
      colors[p + v * 3 + 2] = _color.b
    }
  })

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/** Зеркалит треугольники по X и разворачивает обход: иначе грани смотрят внутрь. */
export function mirrorX(triangles: Triangle[]): Triangle[] {
  const flip = (v: Vec3): Vec3 => [-v[0], v[1], v[2]]
  return triangles.map((t) => tri(flip(t.a), flip(t.c), flip(t.b), t.color))
}

/** Симметричная деталь: половина плюс её зеркало. Пишем один борт, получаем оба. */
export function symmetric(halfTriangles: Triangle[]): Triangle[] {
  return [...halfTriangles, ...mirrorX(halfTriangles)]
}

