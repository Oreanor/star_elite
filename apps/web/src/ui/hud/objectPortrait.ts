/**
 * Портреты мелких объектов в клетке HUD: контейнер, астероид, станция.
 * Символы, не GLB: 48px, крутятся от `world.time`, ноль аллокаций в кадре.
 */

const TAU = Math.PI * 2

/** Переиспользуемые точки проекции — горячий путь HUD. */
const _px = new Float64Array(8)
const _py = new Float64Array(8)
const _pz = new Float64Array(8)

type Face = { i: readonly [number, number, number, number]; z: number }

const BOX_FACES: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 3, 2], // -Z
  [4, 5, 7, 6], // +Z
  [0, 1, 5, 4], // -Y
  [2, 3, 7, 6], // +Y
  [0, 2, 6, 4], // -X
  [1, 3, 7, 5], // +X
]

const _faces: Face[] = BOX_FACES.map((i) => ({ i, z: 0 }))

/**
 * Контейнер: ящик 2.4×2.4×3.4 (как podGeometry), кувыркается.
 * Заливка + рёбра — читается на 48px как груз, не как точка.
 */
export function drawPodCrate(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: number,
  color: string,
  time: number,
): void {
  const yaw = time * 1.1
  const pitch = time * 0.7
  const cyA = Math.cos(yaw)
  const syA = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  // Полуразмеры в долях клетки; длинная ось — Z, как у меша.
  const hx = cell * 0.18
  const hy = cell * 0.18
  const hz = cell * 0.26
  let n = 0
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        let x = sx * hx
        let y = sy * hy
        let z = sz * hz
        // pitch X, затем yaw Y.
        const y1 = y * cp - z * sp
        const z1 = y * sp + z * cp
        const x2 = x * cyA + z1 * syA
        const z2 = -x * syA + z1 * cyA
        _px[n] = cx + x2
        _py[n] = cy + y1 * 0.92 + z2 * 0.22
        _pz[n] = z2
        n++
      }
    }
  }
  for (let f = 0; f < 6; f++) {
    const idx = BOX_FACES[f]!
    _faces[f]!.z = (_pz[idx[0]]! + _pz[idx[1]]! + _pz[idx[2]]! + _pz[idx[3]]!) * 0.25
  }
  _faces.sort((a, b) => a.z - b.z)

  for (const face of _faces) {
    const [a, b, c, d] = face.i
    const shade = 0.45 + 0.55 * (0.5 + face.z / (hz * 2))
    ctx.fillStyle = shadeHex(color, shade)
    ctx.beginPath()
    ctx.moveTo(_px[a]!, _py[a]!)
    ctx.lineTo(_px[b]!, _py[b]!)
    ctx.lineTo(_px[c]!, _py[c]!)
    ctx.lineTo(_px[d]!, _py[d]!)
    ctx.closePath()
    ctx.fill()
  }
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  for (const face of _faces) {
    const [a, b, c, d] = face.i
    ctx.beginPath()
    ctx.moveTo(_px[a]!, _py[a]!)
    ctx.lineTo(_px[b]!, _py[b]!)
    ctx.lineTo(_px[c]!, _py[c]!)
    ctx.lineTo(_px[d]!, _py[d]!)
    ctx.closePath()
    ctx.stroke()
  }
}

/**
 * Астероид: неровный многоугольник, крутится. Зерно от id — одна глыба всегда одна.
 */
export function drawAsteroidChunk(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: number,
  color: string,
  id: number,
  time: number,
): void {
  const n = 7 + (id % 3)
  const baseR = cell * 0.34
  const rot = time * 0.9 + id * 0.31
  ctx.fillStyle = color
  ctx.strokeStyle = shadeHex(color, 0.55)
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU
    // Детерминированная «глыба», не Math.random.
    const wobble = 0.72 + 0.28 * Math.sin(id * 12.9898 + i * 3.7)
    const r = baseR * wobble
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r * 0.9
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Внутренний скол — объём без освещения сцены.
  ctx.strokeStyle = shadeHex(color, 1.25)
  ctx.beginPath()
  const ir = baseR * 0.35
  for (let i = 0; i < 4; i++) {
    const a = -rot * 0.6 + (i / 4) * TAU + 0.4
    const x = cx + Math.cos(a) * ir
    const y = cy + Math.sin(a) * ir * 0.9
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

/**
 * Станция: белое колесо со спицами (символ, не GLB). Медленно крутится.
 */
export function drawStationWheel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: number,
  color: string,
  time: number,
): void {
  const outer = cell * 0.38
  const inner = cell * 0.1
  const hub = cell * 0.05
  const spokes = 8
  const rot = time * 0.35

  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.5

  ctx.beginPath()
  ctx.arc(cx, cy, outer, 0, TAU)
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, inner, 0, TAU)
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, hub, 0, TAU)
  ctx.fill()

  for (let i = 0; i < spokes; i++) {
    const a = rot + (i / spokes) * TAU
    const c = Math.cos(a)
    const s = Math.sin(a)
    ctx.beginPath()
    ctx.moveTo(cx + c * inner, cy + s * inner)
    ctx.lineTo(cx + c * outer, cy + s * outer)
    ctx.stroke()
  }
}

/**
 * Иконка ВОЕННОЙ БАЗЫ: шар с параллелями-меридианами (глобус) + башенка на полюсе.
 * Читается «рукотворная сфера на снос», а не камень и не станция-колесо.
 */
export function drawWarBaseIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cell: number,
  color: string,
  time: number,
): void {
  const R = cell * 0.36
  const rot = time * 0.25

  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.5

  // Силуэт сферы.
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, TAU)
  ctx.stroke()

  // Три параллели (эллипсы разной высоты) — читаются как широты глобуса.
  for (const f of [0.35, 0.7, 0.95]) {
    ctx.beginPath()
    ctx.ellipse(cx, cy, R * f, R * f * 0.34, 0, 0, TAU)
    ctx.stroke()
  }
  // Меридиан, слегка «крутящийся» по времени — база вращается.
  const mw = Math.abs(Math.cos(rot)) * R
  ctx.beginPath()
  ctx.ellipse(cx, cy, mw, R, 0, 0, TAU)
  ctx.stroke()

  // Башня на «северном» полюсе: коротышка-штырёк наружу.
  ctx.beginPath()
  ctx.moveTo(cx, cy - R)
  ctx.lineTo(cx, cy - R - cell * 0.14)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy - R - cell * 0.14, cell * 0.04, 0, TAU)
  ctx.fill()
}

/** `shade` 1 = как есть; <1 темнее; >1 светлее (зажим 0..255). */
function shadeHex(hex: string, shade: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  if (!Number.isFinite(n)) return hex
  const r = Math.min(255, Math.max(0, (((n >> 16) & 255) * shade) | 0))
  const g = Math.min(255, Math.max(0, (((n >> 8) & 255) * shade) | 0))
  const b = Math.min(255, Math.max(0, ((n & 255) * shade) | 0))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
