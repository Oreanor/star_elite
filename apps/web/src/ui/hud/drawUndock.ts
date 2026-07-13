import { HUD_SCALE } from '../../render/config'
import { undockProgress } from '../../app/control/undockFx'
import { HUD_COLORS } from './draw'

/**
 * Тоннель вылета в растре HUD — чёрный кадр с растущей круглой прорезью на живой
 * космос и два голубых кольца, летящих перед ней. Всё в экранных пикселях, а не в
 * 3D: маска обязана лечь ровным кругом поверх кадра, а не искажаться перспективой.
 *
 * Прорезь режется `destination-out` — она делает пиксель ПРОЗРАЧНЫМ, и сквозь HUD-холст
 * проступает 3D-сцена под ним. Кривые «медленно → быстро» дают ощущение выброса из
 * тёмного тоннеля; кольца стартуют со сдвигом — отсюда ритм «вжуу-вжуу-вжууух».
 */

const S = HUD_SCALE
const TAU = Math.PI * 2

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
/** Ускоряющаяся кривая: медленно у нуля, круто к единице. */
const easeIn = (u: number, p: number): number => Math.pow(clamp01(u), p)

/** Кольцо проходит свой путь БЫСТРЕЕ маски и раньше — оно идёт «перед» прорезью. */
const RING_SPAN = 0.5
/** Старт второго кольца позже первого — два раздельных «вжуу». */
const RING_DELAYS = [0, 0.14] as const

/** Радиус кольца как доля полного, со своим стартом. Ускоряется — отсюда «вж-ж-жух». */
function ringFrac(p: number, delay: number): number {
  return easeIn((p - delay) / RING_SPAN, 1.9)
}

/** Яркость кольца: резкий проблеск на старте, плавный спад по мере ухода за край. */
function ringAlpha(p: number, delay: number): number {
  const u = clamp01((p - delay) / RING_SPAN)
  if (u <= 0 || u >= 1) return 0
  return clamp01(u * 8) * Math.pow(1 - u, 1.5)
}

function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha: number): void {
  if (alpha <= 0 || r <= 0) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // Широкий тусклый ореол под тонким ярким ядром — кольцо «светится», а не просто линия.
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
  const p = undockProgress()
  if (p <= 0) return

  const cx = width / 2
  const cy = height / 2
  const diag = Math.hypot(width, height)
  // Полный радиус с запасом за углы (половина диагонали ≈ 0.5·diag): к финалу космос
  // виден целиком, без чёрных углов.
  const full = diag * 0.6

  // ── Маска-тоннель: чёрный кадр, в центре растущая прозрачная прорезь ─────────────
  const hole = easeIn(p, 2.4) * full
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(cx, cy, hole, 0, TAU)
  ctx.fill()
  ctx.restore()

  // ── Кольца ПОВЕРХ маски, впереди прорези («с запасом» за край экрана) ────────────
  const reach = diag * 0.78
  for (const delay of RING_DELAYS) {
    ring(ctx, cx, cy, ringFrac(p, delay) * reach, ringAlpha(p, delay))
  }
}
