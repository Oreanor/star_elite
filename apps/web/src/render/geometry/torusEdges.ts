import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from 'three'
import { makeRng, slerpS3, stereoProject, type HypertorusGrid } from '@elite/sim'
import { TORUS } from '../config'

const samples = TORUS.EDGE_SEGMENTS + 1
const _arc = new Float64Array(4)
const _bend = new Float64Array(4)
const _direction = new Float64Array(4)
const _point = { x: 0, y: 0, z: 0, depth: 0 }
const _positions = new Float64Array(samples * 3)
const _widths = new Float32Array(samples)
const _brightness = new Float32Array(samples)

/** Дополнительные потоки — только облик комнаты; исходная карта и навигация не меняются. */
export function torusFlowGrid(grid: HypertorusGrid): HypertorusGrid {
  const edges = Array.from(grid.edges)
  const used = new Set<number>()
  const key = (a: number, b: number) => Math.min(a, b) * grid.vertCount + Math.max(a, b)
  for (let e = 0; e < grid.edgeCount; e++) used.add(key(edges[e * 2]!, edges[e * 2 + 1]!))
  const rng = makeRng(TORUS.EDGE_SEED)
  const minDot = Math.cos(TORUS.EDGE_EXTRA_MAX_ANGLE)
  const candidates: number[] = []
  for (let from = 0; from < grid.vertCount; from++) {
    candidates.length = 0
    for (let to = 0; to < grid.vertCount; to++) {
      if (to === from || used.has(key(from, to))) continue
      let dot = 0
      for (let c = 0; c < 4; c++) dot += grid.verts[from * 4 + c]! * grid.verts[to * 4 + c]!
      if (dot >= minDot && dot < 1 - 1e-6) candidates.push(to)
    }
    for (let n = 0; n < TORUS.EDGE_EXTRA_PER_NODE && candidates.length > 0; n++) {
      const pick = Math.floor(rng() * candidates.length)
      const to = candidates[pick]!
      candidates[pick] = candidates[candidates.length - 1]!
      candidates.pop()
      edges.push(from, to)
      used.add(key(from, to))
    }
  }
  return { ...grid, edges: Int32Array.from(edges), edgeCount: edges.length / 2 }
}

/** Общие вершины соседних треугольников дают непрерывную нить без бусин и ярких стыков. */
export function torusEdgesGeometry(edgeCount: number): BufferGeometry {
  const g = new BufferGeometry()
  const vertices = edgeCount * samples * 2
  for (const [name, size] of [['position', 3], ['aTangent', 3], ['aWidth', 1], ['aSide', 1], ['aBright', 1], ['aFlow', 2]] as const) {
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
  const flow = g.getAttribute('aFlow') as BufferAttribute
  const indices = g.getIndex()!
  let indexCount = 0
  for (let e = 0; e < grid.edgeCount; e++) {
    const from = grid.edges[e * 2]!
    const to = grid.edges[e * 2 + 1]!
    let dot = 0
    for (let c = 0; c < 4; c++) dot += rotated[from * 4 + c]! * rotated[to * 4 + c]!
    const length = Math.sqrt(Math.max(1e-12, 1 - dot * dot))
    for (let c = 0; c < 4; c++) _direction[c] = (rotated[to * 4 + c]! - dot * rotated[from * 4 + c]!) / length
    // Плоскость изгиба привязана к решётке S³: при полёте дуга не переворачивается к камере.
    let norm = 0
    for (let candidate = 0; candidate < grid.vertCount && norm < 1e-6; candidate++) {
      const other = ((from + 137 + candidate) % grid.vertCount) * 4
      let along = 0
      let radial = 0
      for (let c = 0; c < 4; c++) {
        along += rotated[other + c]! * _direction[c]!
        radial += rotated[other + c]! * rotated[from * 4 + c]!
      }
      norm = 0
      for (let c = 0; c < 4; c++) {
        _bend[c] = rotated[other + c]! - along * _direction[c]! - radial * rotated[from * 4 + c]!
        norm += _bend[c]! * _bend[c]!
      }
    }
    const phase = ((Math.imul(e + 1, 2654435761) >>> 0) / 4294967296)
    const bendScale = TORUS.EDGE_BEND * length * (0.75 + phase * 0.5) / Math.sqrt(Math.max(norm, 1e-12))
    for (let k = 0; k < samples; k++) {
      const t = k / TORUS.EDGE_SEGMENTS
      slerpS3(rotated, from, to, t, _arc)
      const bend = Math.sin(Math.PI * t) * bendScale
      let normSq = 0
      for (let c = 0; c < 4; c++) {
        _arc[c] = _arc[c]! + _bend[c]! * bend
        normSq += _arc[c]! * _arc[c]!
      }
      const invLength = 1 / Math.sqrt(normSq)
      for (let c = 0; c < 4; c++) _arc[c] = _arc[c]! * invLength
      const w = _arc[3]!
      _brightness[k] = 0
      if (w > TORUS.POLE_CULL) continue
      stereoProject(_arc[0]!, _arc[1]!, _arc[2]!, w, scale, _point)
      _positions[k * 3] = _point.x
      _positions[k * 3 + 1] = _point.y
      _positions[k * 3 + 2] = _point.z
      _brightness[k] = brightness(Math.hypot(_point.x, _point.y, _point.z))
      // У узлов газ расплывается, в середине стягивается в струю, как в звёздной паре.
      const neck = 0.6 + 0.8 * Math.pow(Math.abs(2 * t - 1), 3)
      _widths[k] = TORUS.EDGE_ANGULAR_WIDTH * neck * scale / Math.max(1e-4, 1 - w)
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
        flow.setXY(v + s, k / TORUS.EDGE_SEGMENTS, phase * 100)
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
  flow.needsUpdate = true
  g.setDrawRange(0, indexCount)
}
