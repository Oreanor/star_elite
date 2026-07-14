import { HUD_SCALE } from '../../render/config'
import {
  MASK_START,
  RING_COUNT,
  RING_INTERVAL,
  UNDOCK_TOTAL,
  undockTime,
} from '../../app/control/undockFx'
import { HUD_COLORS } from './draw'

/**
 * Тоннель вылета: чёрный кадр, четыре импульсных кольца каждые 0.3 с, на пятом —
 * прорезь на космос с голубым ободом (как раньше). Без общих кривых и догонялок.
 */

const S = HUD_SCALE
const TAU = Math.PI * 2

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const easeIn = (u: number, p: number): number => Math.pow(clamp01(u), p)

/** Маска: медленно → быстро, как было. */
const MASK_EASE = 2.4
/** Импульсное кольцо растёт за этот интервал после старта. */
const PULSE_SPAN = RING_INTERVAL

function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha: number): void {
  if (alpha <= 0 || r <= 0) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = alpha * 0.5
  ctx.strokeStyle = HUD_COLORS.PRIMARY
  ctx.lineWidth = 4 * S
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TAU)
  ctx.stroke()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = '#dff1ff'
  ctx.lineWidth = 1.25 * S
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TAU)
  ctx.stroke()
  ctx.restore()
}

export function drawUndockTunnel(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const t = undockTime()
  if (t <= 0) return

  const cx = width / 2
  const cy = height / 2
  const diag = Math.hypot(width, height)
  const full = diag * 0.6
  const reach = diag * 0.78

  // ── Маска: до 1.2 с — сплошной чёрный; с 1.2 с — прорезь на космос ─────────────
  let hole = 0
  if (t >= MASK_START) {
    const maskAge = t - MASK_START
    const maskDur = UNDOCK_TOTAL - MASK_START
    hole = easeIn(maskAge / maskDur, MASK_EASE) * full
  }

  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  if (hole > 0) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.arc(cx, cy, hole, 0, TAU)
    ctx.fill()
  }
  ctx.restore()

  // ── Кольца 1–4: каждые 0.3 с новый импульс ───────────────────────────────────
  for (let i = 0; i < RING_COUNT - 1; i++) {
    const start = i * RING_INTERVAL
    if (t < start) continue
    const u = clamp01((t - start) / PULSE_SPAN)
    const alpha = clamp01(u * 10) * Math.pow(1 - u, 1.4)
    ring(ctx, cx, cy, easeIn(u, MASK_EASE) * reach, alpha)
  }

  // ── Кольцо 5: обод прорези (маска на космосе) ──────────────────────────────────
  if (t >= MASK_START && hole > 0) {
    const maskAge = t - MASK_START
    const maskDur = UNDOCK_TOTAL - MASK_START
    const edgeAlpha = 0.85 * clamp01((maskAge / maskDur) * 8)
    ring(ctx, cx, cy, hole, edgeAlpha)
  }
}
