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
/** ВСЕ кольца растут за один интервал — единая скорость, равный зазор RING_INTERVAL.
 *  Тем же интервалом растёт и прорезь-маска, поэтому обод идёт ВРОВЕНЬ с последним
 *  кольцом. Делитель задаёт скорость: 1.17 — на 10% медленнее прежних 1.3. */
const RING_SPAN = (UNDOCK_TOTAL - MASK_START) / 1.17

function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha: number): void {
  if (alpha <= 0 || r <= 0) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // Голубой ореол — широкая мягкая полоса свечения: шире и прозрачнее (мягче).
  ctx.globalAlpha = alpha * 0.5
  ctx.strokeStyle = HUD_COLORS.PRIMARY
  ctx.lineWidth = 11 * S
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TAU)
  ctx.stroke()
  ctx.globalAlpha = alpha * 0.75
  ctx.strokeStyle = '#dff1ff'
  ctx.lineWidth = 3 * S
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

  // ── Маска: сплошной чёрный, затем прорезь на космос ────────────────────────────
  // Прорезь растёт по ТОЙ ЖЕ кривой и за тот же RING_SPAN, что и последнее кольцо
  // (оно стартует ровно на MASK_START), поэтому обод и кольцо идут вровень.
  let hole = 0
  if (t >= MASK_START) {
    hole = easeIn((t - MASK_START) / RING_SPAN, MASK_EASE) * full
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

  // ── Все кольца: равный интервал RING_INTERVAL, единая (медленная) скорость ──────
  // Последнее кольцо стартует ровно на MASK_START и растёт как обод прорези (та же
  // кривая easeIn·full), поэтому отдельного «пятого» блока больше нет — тоннель
  // однороден до самого конца, и последнее кольцо вылетает как все прочие.
  for (let i = 0; i < RING_COUNT; i++) {
    const start = i * RING_INTERVAL
    if (t < start) continue
    const u = clamp01((t - start) / RING_SPAN)
    const alpha = 0.9 * clamp01(u * 8) * clamp01((1 - u) / 0.3)
    ring(ctx, cx, cy, easeIn(u, MASK_EASE) * full, alpha)
  }
}
