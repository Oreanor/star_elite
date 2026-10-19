import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from 'three'
import { slerpS3, stereoProject, type HypertorusGrid } from '@elite/sim'
import { TORUS } from '../config'

const samples = TORUS.EDGE_SEGMENTS + 1
const _arc = new Float64Array(4)
const _point = { x: 0, y: 0, z: 0, depth: 0 }
const _positions = new Float64Array(samples * 3)
const _widths = new Float32Array(samples)
const _brightness = new Float32Array(samples)

/** Общие вершины соседних треугольников дают непрерывную нить без бусин и ярких стыков. */
export function torusEdgesGeometry(edgeCount: number): BufferGeometry {
  const g = new BufferGeometry()
  const vertices = edgeCount * samples * 2
  for (const [name, size] of [['position', 3], ['aTangent', 3], ['aWidth', 1], ['aSide', 1], ['aBright', 1]] as const) {
    g.setAttribute(name, new BufferAttribute(new Float32Array(vertices * size), size).setUsage(DynamicDrawUsage))
  }
  g.setIndex(new BufferAttribute(new Uint32Array(edgeCount * TORUS.EDGE_SEGMENTS * 6), 1).setUsage(DynamicDrawUsage))
  g.setDrawRange(0, 0)
  return g
}

export function updateTorusEdges(g: BufferGeometry, grid: HypertorusGrid, rotated: Float64Array, scale: number, brightness: (distance: number) => number): void {
  const pos = g.getAttribute('position') as BufferAttribute
  const tangent = g.getAttribute('aTangent') as BufferAttribute
  const width = g.getAttribute('aWidth') as BufferAttribute
  const side = g.getAttribute('aSide') as BufferAttribute
  const bright = g.getAttribute('aBright') as BufferAttribute
  const indices = g.getIndex()!
  let indexCount = 0
  for (let e = 0; e < grid.edgeCount; e++) {
    for (let k = 0; k < samples; k++) {
      slerpS3(rotated, grid.edges[e * 2]!, grid.edges[e * 2 + 1]!, k / TORUS.EDGE_SEGMENTS, _arc)
      const w = _arc[3]!
      _brightness[k] = 0
      if (w > TORUS.POLE_CULL) continue
      stereoProject(_arc[0]!, _arc[1]!, _arc[2]!, w, scale, _point)
      _positions[k * 3] = _point.x
      _positions[k * 3 + 1] = _point.y
      _positions[k * 3 + 2] = _point.z
      _brightness[k] = brightness(Math.hypot(_point.x, _point.y, _point.z))
      _widths[k] = TORUS.EDGE_ANGULAR_WIDTH * scale / Math.max(1e-4, 1 - w)
    }
    for (let k = 0; k < samples; k++) {
      if (_brightness[k]! <= 0) continue
      const prev = k > 0 && _brightness[k - 1]! > 0 ? k - 1 : k
      const next = k + 1 < samples && _brightness[k + 1]! > 0 ? k + 1 : k
      const v = (e * samples + k) * 2
      for (let s = 0; s < 2; s++) {
        pos.setXYZ(v + s, _positions[k * 3]!, _positions[k * 3 + 1]!, _positions[k * 3 + 2]!)
        tangent.setXYZ(v + s, _positions[next * 3]! - _positions[prev * 3]!, _positions[next * 3 + 1]! - _positions[prev * 3 + 1]!, _positions[next * 3 + 2]! - _positions[prev * 3 + 2]!)
        width.setX(v + s, _widths[k]!)
        side.setX(v + s, s * 2 - 1)
        bright.setX(v + s, _brightness[k]!)
      }
      // Не соединяем участки через полюс проекции или скрытый туманом промежуток.
      if (k === 0 || _brightness[k - 1]! <= 0) continue
      indices.setX(indexCount++, v - 2)
      indices.setX(indexCount++, v - 1)
      indices.setX(indexCount++, v)
      indices.setX(indexCount++, v - 1)
      indices.setX(indexCount++, v + 1)
      indices.setX(indexCount++, v)
    }
  }
  pos.needsUpdate = tangent.needsUpdate = width.needsUpdate = side.needsUpdate = bright.needsUpdate = true
  indices.needsUpdate = true
  g.setDrawRange(0, indexCount)
}
