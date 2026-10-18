import { currentGameDate } from '../clock'
import { moneyNumber } from '../station/Money'
import { HUD_COLORS } from './draw'
import type { HudFrame } from './hudShared'

/**
 * Плашка «дата | кошелёк» в левом верхнем углу — ТА ЖЕ, что в шапке станции, и того же
 * размера: игрок видит один прибор в полёте и у причала.
 *
 * Размеры — те же числа, что у станционной вёрстки (Tailwind: `text-sm`, `px-4 py-2`,
 * `gap-5`, `rounded-lg`, `tracking-widest`), в rem страницы. Канвас HUD в CSS-пикселях
 * один к одному (`PIXEL_SCALE = 1`), а кегль страницы зависит от окна (см. styles.css),
 * поэтому rem берём живым — плашки совпадают на любом экране.
 *
 * Дата — общий календарь (`worldClock`), не `world.time`.
 */

/** Подложка, рамка, цвета — как у станционной плашки. */
const PLATE_FILL = 'rgba(8,22,42,0.75)'
const MONEY_TONE = '#ffffff'
const FONT_FAMILY = '"Consolas", "DejaVu Sans Mono", monospace'

/** Кегль страницы, px. Читаем не каждый кадр: getComputedStyle — пересчёт стилей. */
let remPx = 16
let remReadAt = -1
function rem(): number {
  const now = performance.now()
  if (now - remReadAt > 1000) {
    remReadAt = now
    const v = parseFloat(getComputedStyle(document.documentElement).fontSize)
    if (Number.isFinite(v) && v > 0) remPx = v
  }
  return remPx
}

export function drawWallet({ ctx, world }: HudFrame): void {
  const r = rem()
  const fontPx = 0.875 * r // text-sm
  const lineH = 1.25 * r // line-height text-sm
  const padX = 1 * r // px-4
  const padY = 0.5 * r // py-2
  const gap = 1.25 * r // gap-5 и pl-5 у черты
  const coinW = 0.68 * fontPx
  const coinH = 0.95 * fontPx
  const coinGap = 0.5 * r // gap-2 у Money
  // Поля — РОВНЫЕ сверху и слева, чуть шире отступа самой плашки.
  const margin = 1.25 * r

  const date = currentGameDate()
  const money = moneyNumber(world.credits)
  const saved = { font: ctx.font, spacing: ctx.letterSpacing, align: ctx.textAlign, base: ctx.textBaseline }

  ctx.letterSpacing = `${(0.1 * fontPx).toFixed(2)}px` // tracking-widest
  ctx.font = `${fontPx}px ${FONT_FAMILY}`
  const dateW = ctx.measureText(date).width
  ctx.font = `600 ${fontPx}px ${FONT_FAMILY}` // font-semibold
  const moneyW = ctx.measureText(money).width

  const x = Math.round(margin)
  const y = Math.round(margin)
  // +2 — рамка в 1 px с каждой стороны: в вёрстке она прибавляется к размеру блока.
  const w = Math.round(padX + dateW + gap + 1 + gap + coinW + coinGap + moneyW + padX + 2)
  const h = Math.round(padY * 2 + lineH + 2)
  const mid = y + h / 2

  ctx.beginPath()
  ctx.roundRect(x + 0.5, y + 0.5, w, h, 0.5 * r) // rounded-lg
  ctx.fillStyle = PLATE_FILL
  ctx.fill()
  ctx.strokeStyle = HUD_COLORS.DIM
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  let cx = x + 1 + padX
  ctx.font = `${fontPx}px ${FONT_FAMILY}`
  ctx.fillStyle = HUD_COLORS.DIM
  ctx.fillText(date, cx, mid)
  cx += dateW + gap

  // Черта — граница блока суммы (border-l), на всю высоту строки.
  ctx.beginPath()
  ctx.moveTo(Math.round(cx) + 0.5, mid - lineH / 2)
  ctx.lineTo(Math.round(cx) + 0.5, mid + lineH / 2)
  ctx.stroke()
  cx += 1 + gap

  // Монетка — стоячий овал с ребром, как `Coin` (viewBox 10×14, штрих 1.4 и 1).
  const sx = coinW / 10
  ctx.strokeStyle = MONEY_TONE
  ctx.lineWidth = 1.4 * sx
  ctx.beginPath()
  ctx.ellipse(cx + coinW / 2, mid, 3.8 * sx, (6 / 14) * coinH, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 1 * sx
  ctx.beginPath()
  ctx.ellipse(cx + coinW / 2, mid, 1.6 * sx, (3 / 14) * coinH, 0, 0, Math.PI * 2)
  ctx.stroke()
  cx += coinW + coinGap

  ctx.font = `600 ${fontPx}px ${FONT_FAMILY}`
  ctx.fillStyle = MONEY_TONE
  ctx.fillText(money, cx, mid)

  ctx.font = saved.font
  ctx.letterSpacing = saved.spacing
  ctx.textAlign = saved.align
  ctx.textBaseline = saved.base
}
