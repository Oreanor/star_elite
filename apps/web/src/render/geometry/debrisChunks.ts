import { BufferAttribute, BufferGeometry, IcosahedronGeometry, Vector3 } from 'three'
import { makeRng } from '@elite/sim'

/**
 * Простые меши осколков глыб двора. Не GLB: десяток граней, продавленных шумом.
 * Текстуру берём с родительского астероида (`warBaseGlbMap`) — UV у икосаэдра
 * сферические, на мелком щебне это читается камнем, а не рваной развёрткой.
 */

const DEBRIS_VARIANTS = 3
const _v = new Vector3()

function chunk(seed: number): BufferGeometry {
  // detail=0: двадцать граней. Мелкий осколок — угловатая галька, не скульптура.
  const geometry = new IcosahedronGeometry(1, 0).toNonIndexed()
  const rng = makeRng(seed)
  const position = geometry.getAttribute('position') as BufferAttribute
  const offsets = new Map<string, number>()
  const keyOf = (x: number, y: number, z: number) =>
    `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`

  for (let i = 0; i < position.count; i++) {
    _v.fromBufferAttribute(position, i)
    const key = keyOf(_v.x, _v.y, _v.z)
    let scale = offsets.get(key)
    if (scale === undefined) {
      scale = 0.55 + rng() * 0.7
      offsets.set(key, scale)
    }
    _v.multiplyScalar(scale)
    position.setXYZ(i, _v.x, _v.y, _v.z)
  }

  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

let variants: BufferGeometry[] | null = null

/** Несколько простых форм осколков. Создаются один раз. */
export function debrisChunkGeometries(): BufferGeometry[] {
  variants ??= Array.from({ length: DEBRIS_VARIANTS }, (_, i) => chunk(0xdec0 + i * 97))
  return variants
}

export const DEBRIS_CHUNK_VARIANTS = DEBRIS_VARIANTS
