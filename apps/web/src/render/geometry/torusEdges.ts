import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Matrix4, StaticDrawUsage, type ShaderMaterial } from 'three'
import { makeRng, slerpS3, type HypertorusGrid, type Pose4 } from '@elite/sim'
import { TORUS } from '../config'

const samples = TORUS.EDGE_SEGMENTS + 1
const _arc = new Float64Array(4)
const _cross = new Float64Array(4)
const _poseMat = new Matrix4()
/** Прошлый кадр: пока поза и туман те же, индексы не переписываем. */
const _poseKey = new Float32Array(16)
let _scaleKey = Number.NaN
let _fogFarKey = Number.NaN
let _curveKey = Number.NaN
/**
 * Единичный боковой вектор изгиба каждой связи в ПОКОЕ решётки. В дугу он впекается
 * один раз (`bakeRest`); дальше позу применяет уже видеокарта.
 */
let _bendRest = new Float64Array(0)

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

/**
 * Лента связи. Точки дуги запечены в покое S³ (`aRest` и соседи): кривизна не зависит от
 * полёта, вращение — линейное. В кадре видеокарта сама проецирует их позой, а процессор
 * только вычёркивает куски за полюсом. Иначе каждый кадр — сотня тысяч slerp и полная
 * перезаливка ленты, и клубок проседает с 60 до 30–50 кадров.
 */
export function torusEdgesGeometry(edgeCount: number): BufferGeometry {
  const g = new BufferGeometry()
  const vertices = edgeCount * samples * 2
  // `position` трёх объявляет сам и ждёт у геометрии. В шейдере он занулён, чтобы атрибут не выкинули.
  g.setAttribute('position', new BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(StaticDrawUsage))
  for (const [name, size] of [['aRest', 4], ['aNext', 4], ['aPrev', 4], ['aSide', 1], ['aFlow', 2]] as const) {
    g.setAttribute(name, new BufferAttribute(new Float32Array(vertices * size), size).setUsage(StaticDrawUsage))
  }
  g.setIndex(new BufferAttribute(new Uint32Array(edgeCount * TORUS.EDGE_SEGMENTS * 6), 1).setUsage(DynamicDrawUsage))
  g.setDrawRange(0, 0)
  return g
}

/** w, при котором дальность проекции равна `fogFar`. Дальше яркость нулевая. */
function wAtFog(scale: number, fogFar: number): number {
  if (!(scale > 1e-6) || !(fogFar > 0)) return -1
  const r = fogFar / scale
  const r2 = r * r
  return (r2 - 1) / (r2 + 1)
}

export function updateTorusEdges(
  g: BufferGeometry,
  material: ShaderMaterial,
  grid: HypertorusGrid,
  pose: Pose4,
  scale: number,
  fogNear: number,
  fogFar: number,
  curvature: number,
): void {
  if (g.userData.curve !== curvature) bakeRest(g, grid, curvature)
  const uniforms = material.uniforms
  if (uniforms.uPose!.value !== _poseMat) uniforms.uPose!.value = _poseMat
  uniforms.uScale!.value = scale
  uniforms.uFogNear!.value = fogNear
  uniforms.uFogFar!.value = fogFar
  const wLimit = Math.min(TORUS.POLE_CULL, wAtFog(scale, fogFar))
  uniforms.uCut!.value = wLimit
  // Поза в uniform — та же матрица, по чьим float32 считается видимость: порог на CPU и GPU один.
  _poseMat.set(
    pose[0]!, pose[1]!, pose[2]!, pose[3]!,
    pose[4]!, pose[5]!, pose[6]!, pose[7]!,
    pose[8]!, pose[9]!, pose[10]!, pose[11]!,
    pose[12]!, pose[13]!, pose[14]!, pose[15]!,
  )
  const e = _poseMat.elements
  let same = _scaleKey === scale && _fogFarKey === fogFar && _curveKey === curvature
  if (same) {
    for (let i = 0; i < 16; i++) if (e[i] !== _poseKey[i]) { same = false; break }
  }
  if (same) return
  _scaleKey = scale
  _fogFarKey = fogFar
  for (let i = 0; i < 16; i++) _poseKey[i] = e[i]!
  const rest = (g.getAttribute('aRest') as BufferAttribute).array as Float32Array
  const indices = g.getIndex()!
  const idx = indices.array as Uint32Array
  const w0 = e[3]!
  const w1 = e[7]!
  const w2 = e[11]!
  const w3 = e[15]!
  let indexCount = 0
  for (let edge = 0; edge < grid.edgeCount; edge++) {
    let prevOk = false
    const base = edge * samples
    for (let k = 0; k < samples; k++) {
      const o = (base + k) * 8
      const ok = w0 * rest[o]! + w1 * rest[o + 1]! + w2 * rest[o + 2]! + w3 * rest[o + 3]! <= wLimit
      if (ok && prevOk) {
        const v = (base + k) * 2
        idx[indexCount++] = v - 2
        idx[indexCount++] = v - 1
        idx[indexCount++] = v
        idx[indexCount++] = v - 1
        idx[indexCount++] = v + 1
        idx[indexCount++] = v
      }
      prevOk = ok
    }
  }
  indices.clearUpdateRanges()
  indices.addUpdateRange(0, indexCount)
  indices.needsUpdate = true
  g.setDrawRange(0, indexCount)
}

/** Дуга с изгибом в покое решётки. Крутилка кривизны перепекает её, полёт — нет. */
function bakeRest(g: BufferGeometry, grid: HypertorusGrid, curvature: number): void {
  if (_bendRest.length !== grid.edgeCount * 4) buildBendRest(grid)
  const rest = (g.getAttribute('aRest') as BufferAttribute).array as Float32Array
  const next = (g.getAttribute('aNext') as BufferAttribute).array as Float32Array
  const prev = (g.getAttribute('aPrev') as BufferAttribute).array as Float32Array
  const side = (g.getAttribute('aSide') as BufferAttribute).array as Float32Array
  const flow = (g.getAttribute('aFlow') as BufferAttribute).array as Float32Array
  const verts = grid.verts
  for (let e = 0; e < grid.edgeCount; e++) {
    const from = grid.edges[e * 2]!
    const to = grid.edges[e * 2 + 1]!
    let dot = 0
    const fo = from * 4
    const to4 = to * 4
    for (let c = 0; c < 4; c++) dot += verts[fo + c]! * verts[to4 + c]!
    const length = Math.sqrt(Math.max(1e-12, 1 - dot * dot))
    const phase = ((Math.imul(e + 1, 2654435761) >>> 0) / 4294967296)
    const bendScale = curvature * length * (0.75 + phase * 0.5)
    const bo = e * 4
    for (let k = 0; k < samples; k++) {
      const t = k / TORUS.EDGE_SEGMENTS
      slerpS3(verts, from, to, t, _arc)
      const bend = Math.sin(Math.PI * t) * bendScale
      let normSq = 0
      for (let c = 0; c < 4; c++) {
        _arc[c] = _arc[c]! + _bendRest[bo + c]! * bend
        normSq += _arc[c]! * _arc[c]!
      }
      const inv = 1 / Math.sqrt(normSq)
      const o = (e * samples + k) * 8
      for (let s = 0; s < 2; s++) {
        const at = o + s * 4
        rest[at] = _arc[0]! * inv
        rest[at + 1] = _arc[1]! * inv
        rest[at + 2] = _arc[2]! * inv
        rest[at + 3] = _arc[3]! * inv
      }
      if (!g.userData.flow) {
        const v = (e * samples + k) * 2
        side[v] = -1
        side[v + 1] = 1
        flow[v * 2] = t
        flow[v * 2 + 1] = phase * 100
        flow[(v + 1) * 2] = t
        flow[(v + 1) * 2 + 1] = phase * 100
      }
    }
    for (let k = 0; k < samples; k++) {
      const nk = k + 1 < samples ? k + 1 : k - 1
      const pk = k > 0 ? k - 1 : 1
      const o = (e * samples + k) * 8
      const no = (e * samples + nk) * 8
      const po = (e * samples + pk) * 8
      for (let s = 0; s < 2; s++) {
        const at = o + s * 4
        const ns = no + s * 4
        const ps = po + s * 4
        next[at] = rest[ns]!
        next[at + 1] = rest[ns + 1]!
        next[at + 2] = rest[ns + 2]!
        next[at + 3] = rest[ns + 3]!
        prev[at] = rest[ps]!
        prev[at + 1] = rest[ps + 1]!
        prev[at + 2] = rest[ps + 2]!
        prev[at + 3] = rest[ps + 3]!
      }
    }
  }
  const restAttr = g.getAttribute('aRest') as BufferAttribute
  const nextAttr = g.getAttribute('aNext') as BufferAttribute
  const prevAttr = g.getAttribute('aPrev') as BufferAttribute
  restAttr.needsUpdate = nextAttr.needsUpdate = prevAttr.needsUpdate = true
  if (!g.userData.flow) {
    ;(g.getAttribute('aSide') as BufferAttribute).needsUpdate = true
    ;(g.getAttribute('aFlow') as BufferAttribute).needsUpdate = true
    g.userData.flow = true
  }
  g.userData.curve = curvature
  _curveKey = curvature
  _scaleKey = Number.NaN
}

/** 0..1 из целого, без Math.random: рисунок изгиба один и тот же между запусками. */
function hash01(n: number): number {
  let x = Math.imul(n + 1, 0x9e3779b1) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296
}

function det3(
  a0: number, a1: number, a2: number,
  b0: number, b1: number, b2: number,
  c0: number, c1: number, c2: number,
): number {
  return a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0)
}

/** Вектор R⁴, перпендикулярный трём данным. Знак не важен: угол изгиба обходит полный круг. */
function cross4(
  ax: number, ay: number, az: number, aw: number,
  bx: number, by: number, bz: number, bw: number,
  cx: number, cy: number, cz: number, cw: number,
  out: Float64Array,
): void {
  out[0] = det3(ay, az, aw, by, bz, bw, cy, cz, cw)
  out[1] = -det3(ax, az, aw, bx, bz, bw, cx, cz, cw)
  out[2] = det3(ax, ay, aw, bx, by, bw, cx, cy, cw)
  out[3] = -det3(ax, ay, az, bx, by, bz, cx, cy, cz)
}

/**
 * Боковое направление каждой связи — произвольный единичный вектор в касательной плоскости
 * S³: перпендикуляр и к узлу, и к хорде. Угол свой у ребра, поэтому соседние потоки не гнутся
 * в одну сторону.
 */
function buildBendRest(grid: HypertorusGrid): void {
  const n = grid.edgeCount
  _bendRest = new Float64Array(n * 4)
  const v = grid.verts
  for (let e = 0; e < n; e++) {
    const from = grid.edges[e * 2]! * 4
    const to = grid.edges[e * 2 + 1]! * 4
    const px = v[from]!
    const py = v[from + 1]!
    const pz = v[from + 2]!
    const pw = v[from + 3]!
    let dot = px * v[to]! + py * v[to + 1]! + pz * v[to + 2]! + pw * v[to + 3]!
    const invLen = 1 / Math.sqrt(Math.max(1e-12, 1 - dot * dot))
    const dx = (v[to]! - dot * px) * invLen
    const dy = (v[to + 1]! - dot * py) * invLen
    const dz = (v[to + 2]! - dot * pz) * invLen
    const dw = (v[to + 3]! - dot * pw) * invLen
    let b1x = 1
    let b1y = 0
    let b1z = 0
    let b1w = 0
    let n1 = 0
    for (let attempt = 0; attempt < 4 && n1 < 1e-8; attempt++) {
      let x = hash01(e * 8 + attempt * 4 + 1) * 2 - 1
      let y = hash01(e * 8 + attempt * 4 + 2) * 2 - 1
      let z = hash01(e * 8 + attempt * 4 + 3) * 2 - 1
      let w = hash01(e * 8 + attempt * 4 + 4) * 2 - 1
      const dp = x * px + y * py + z * pz + w * pw
      const dd = x * dx + y * dy + z * dz + w * dw
      x -= dp * px + dd * dx
      y -= dp * py + dd * dy
      z -= dp * pz + dd * dz
      w -= dp * pw + dd * dw
      n1 = x * x + y * y + z * z + w * w
      b1x = x
      b1y = y
      b1z = z
      b1w = w
    }
    const inv1 = 1 / Math.sqrt(Math.max(n1, 1e-12))
    b1x *= inv1
    b1y *= inv1
    b1z *= inv1
    b1w *= inv1
    cross4(px, py, pz, pw, dx, dy, dz, dw, b1x, b1y, b1z, b1w, _cross)
    const inv2 = 1 / (Math.hypot(_cross[0]!, _cross[1]!, _cross[2]!, _cross[3]!) || 1)
    const theta = hash01(e + 0x51ed) * Math.PI * 2
    const c = Math.cos(theta)
    const s = Math.sin(theta)
    const o = e * 4
    _bendRest[o] = c * b1x + s * _cross[0]! * inv2
    _bendRest[o + 1] = c * b1y + s * _cross[1]! * inv2
    _bendRest[o + 2] = c * b1z + s * _cross[2]! * inv2
    _bendRest[o + 3] = c * b1w + s * _cross[3]! * inv2
  }
}
