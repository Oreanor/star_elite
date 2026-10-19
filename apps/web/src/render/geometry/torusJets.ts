import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from 'three'

/** Корень и конец: ширина сужается, а свет вдоль ленты гасит уже шейдер. */
const SAMPLES = 2
const VERTS = SAMPLES * 2

/** Ленты джетов. Индексы постоянны, в кадре пишутся только координаты видимых лучей. */
export function torusJetsGeometry(beamCount: number): BufferGeometry {
  const g = new BufferGeometry()
  const count = Math.max(1, beamCount)
  const vertices = count * VERTS
  for (const [name, size] of [['position', 3], ['aTangent', 3], ['aWidth', 1], ['aSide', 1], ['aAlong', 1], ['aBright', 1]] as const) {
    g.setAttribute(name, new BufferAttribute(new Float32Array(vertices * size), size).setUsage(DynamicDrawUsage))
  }
  const idx = new Uint32Array(count * 6)
  for (let b = 0; b < count; b++) {
    const v = b * VERTS
    const i = b * 6
    idx[i] = v
    idx[i + 1] = v + 1
    idx[i + 2] = v + 2
    idx[i + 3] = v + 1
    idx[i + 4] = v + 3
    idx[i + 5] = v + 2
  }
  g.setIndex(new BufferAttribute(idx, 1))
  g.setDrawRange(0, 0)
  return g
}

/** Один луч из точки вдоль оси. Конец остаётся широким: остриё снова читалось бы иголкой. */
export function writeTorusJet(
  g: BufferGeometry,
  beam: number,
  x: number,
  y: number,
  z: number,
  ax: number,
  ay: number,
  az: number,
  length: number,
  halfWidth: number,
  gain: number,
): void {
  const pos = g.getAttribute('position') as BufferAttribute
  const tangent = g.getAttribute('aTangent') as BufferAttribute
  const width = g.getAttribute('aWidth') as BufferAttribute
  const side = g.getAttribute('aSide') as BufferAttribute
  const along = g.getAttribute('aAlong') as BufferAttribute
  const bright = g.getAttribute('aBright') as BufferAttribute
  const v = beam * VERTS
  const tipHalf = halfWidth * 0.45
  for (let s = 0; s < 2; s++) {
    const sd = s * 2 - 1
    const root = v + s
    const tip = v + 2 + s
    pos.setXYZ(root, x, y, z)
    pos.setXYZ(tip, x + ax * length, y + ay * length, z + az * length)
    tangent.setXYZ(root, ax, ay, az)
    tangent.setXYZ(tip, ax, ay, az)
    width.setX(root, halfWidth)
    width.setX(tip, tipHalf)
    side.setX(root, sd)
    side.setX(tip, sd)
    along.setX(root, 0)
    along.setX(tip, 1)
    bright.setX(root, gain)
    bright.setX(tip, gain)
  }
}

export function touchTorusJets(g: BufferGeometry, beams: number): void {
  for (const name of ['position', 'aTangent', 'aWidth', 'aSide', 'aAlong', 'aBright']) {
    g.getAttribute(name)!.needsUpdate = true
  }
  g.setDrawRange(0, beams * 6)
}
