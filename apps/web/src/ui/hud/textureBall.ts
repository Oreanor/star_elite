/**
 * Вращающийся текстурный шарик для клетки HUD (звезда / планета / луна).
 * Без освещения — только UV-вращение и опциональный морфинг.
 * Проекция — «рыбий глаз»: камера близко к сфере, центр раздут, лимб сжат.
 * 48², один раз за кадр на одну цель.
 */

const BALL = 48
const TAU = Math.PI * 2
/**
 * Дистанция камеры от центра единичной сферы (>1). Ближе → сильнее рыбий глаз.
 * 1.35: читается на 48px, не уезжает в карикатуру.
 */
const EYE = 1.35
/** Половина углового размера силуэта: asin(1/EYE). */
const SILHOUETTE = Math.asin(1 / EYE)

type Decoded = { w: number; h: number; data: Uint8ClampedArray }
export type BallSample = (u: number, v: number) => [number, number, number]

const images = new Map<string, HTMLImageElement>()
const decoded = new Map<string, Decoded>()
const failed = new Set<string>()

let outCanvas: HTMLCanvasElement | null = null
let outCtx: CanvasRenderingContext2D | null = null
let outPixels: ImageData | null = null

function ensureOut(): CanvasRenderingContext2D {
  if (!outCanvas) {
    outCanvas = document.createElement('canvas')
    outCanvas.width = BALL
    outCanvas.height = BALL
    outCtx = outCanvas.getContext('2d', { willReadFrequently: true })
    outPixels = outCtx!.createImageData(BALL, BALL)
  }
  return outCtx!
}

/** Ленивая загрузка + декод в CPU. Пока нет данных — `null`. */
export function loadTexturePixels(url: string): Decoded | null {
  if (failed.has(url)) return null
  const ready = decoded.get(url)
  if (ready) return ready

  let img = images.get(url)
  if (!img) {
    img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img!.naturalWidth
      c.height = img!.naturalHeight
      const g = c.getContext('2d')
      if (!g) return
      g.drawImage(img!, 0, 0)
      try {
        const id = g.getImageData(0, 0, c.width, c.height)
        decoded.set(url, { w: id.width, h: id.height, data: id.data })
      } catch {
        failed.add(url)
      }
    }
    img.onerror = () => failed.add(url)
    img.src = url
    images.set(url, img)
  }
  return decoded.get(url) ?? null
}

function sampleTex(src: Decoded, u: number, v: number): [number, number, number] {
  let uu = u - Math.floor(u)
  if (uu < 0) uu += 1
  const vv = Math.min(1, Math.max(0, v))
  const x = Math.min(src.w - 1, (uu * src.w) | 0)
  const y = Math.min(src.h - 1, (vv * src.h) | 0)
  const i = (y * src.w + x) * 4
  return [src.data[i]!, src.data[i + 1]!, src.data[i + 2]!]
}

export type BallPaintOpts = {
  /** рад/с собственного вращения вокруг Y. */
  spin: number
  /** амплитуда «кипения» UV; 0 — твёрдое тело. */
  boil: number
}

function paintBall(sample: BallSample, time: number, opts: BallPaintOpts): HTMLCanvasElement {
  const ctx = ensureOut()
  const pix = outPixels!
  const data = pix.data
  const spin = time * opts.spin
  const ca = Math.cos(spin)
  const sa = Math.sin(spin)
  const boilT = time * 0.6
  const boil = opts.boil
  const oo = EYE * EYE
  const oo1 = oo - 1

  for (let py = 0; py < BALL; py++) {
    for (let px = 0; px < BALL; px++) {
      const o = (py * BALL + px) * 4
      const nx = ((px + 0.5) / BALL) * 2 - 1
      const ny = ((py + 0.5) / BALL) * 2 - 1
      const rad = Math.sqrt(nx * nx + ny * ny)
      if (rad > 1) {
        data[o] = 0
        data[o + 1] = 0
        data[o + 2] = 0
        data[o + 3] = 0
        continue
      }
      const th = rad * SILHOUETTE
      const s = Math.sin(th)
      const c = Math.cos(th)
      const inv = rad > 1e-8 ? s / rad : 0
      const dx = nx * inv
      const dy = ny * inv
      const dz = c
      const od = -EYE * dz
      const disc = od * od - oo1
      const t = -od - Math.sqrt(Math.max(0, disc))
      const hx = t * dx
      const hy = t * dy
      const hz = -EYE + t * dz
      const rx = ca * hx + sa * hz
      const rz = -sa * hx + ca * hz
      let u = Math.atan2(rz, rx) / TAU + 0.5
      let v = Math.asin(Math.min(1, Math.max(-1, hy))) / Math.PI + 0.5
      if (boil > 0) {
        u += boil * Math.sin(v * 16 + boilT)
        v += boil * 0.5 * Math.sin(u * 20 - boilT * 0.85)
      }
      const [r, g, b] = sample(u, v)
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = 255
    }
  }
  ctx.putImageData(pix, 0, 0)
  return outCanvas!
}

function blitBall(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ballR: number,
  rimColor: string,
  ball: HTMLCanvasElement,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, ballR, 0, TAU)
  ctx.clip()
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(ball, cx - ballR, cy - ballR, ballR * 2, ballR * 2)
  ctx.restore()
  ctx.strokeStyle = rimColor
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, cy, ballR, 0, TAU)
  ctx.stroke()
}

/** Рисует шарик по сэмплеру UV (процедурка или обёртка над картой). */
export function drawSampledBall(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ballR: number,
  rimColor: string,
  time: number,
  opts: BallPaintOpts,
  sample: BallSample,
): void {
  blitBall(ctx, cx, cy, ballR, rimColor, paintBall(sample, time, opts))
}

/**
 * Рисует шарик с карты. Карты ещё нет / 404 → false (зови фолбэк).
 */
export function drawTextureBall(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ballR: number,
  rimColor: string,
  url: string,
  time: number,
  opts: BallPaintOpts,
): boolean {
  const src = loadTexturePixels(url)
  if (!src) return false
  drawSampledBall(ctx, cx, cy, ballR, rimColor, time, opts, (u, v) => sampleTex(src, u, v))
  return true
}

/** Дешёвый hash → 0..1 для процедурной грануляции. */
export function hash2(u: number, v: number, seed: number): number {
  const x = Math.sin(u * 127.1 + v * 311.7 + seed * 0.013) * 43758.5453
  return x - Math.floor(x)
}
