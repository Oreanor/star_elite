/**
 * Примитивы отрисовки HUD. Всё рисуется целыми пикселями внутреннего буфера:
 * при увеличении ближайшим соседом дробная координата размазала бы линию.
 */

import { UI } from '../theme'

/** HUD не заводит свою палитру: оттенок дисплея один на весь корабль. */
export const HUD_COLORS = UI

/** Целые координаты: полупиксельная линия в canvas2d размывается в две серые. */
const snap = (v: number) => Math.round(v) + 0.5

export function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 1) {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(snap(x1), snap(y1))
  ctx.lineTo(snap(x2), snap(y2))
  ctx.stroke()
}

export function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.strokeRect(snap(x), snap(y), Math.round(w), Math.round(h))
}

export function fillRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

export function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, width = 1) {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2)
  ctx.stroke()
}

/** Эллипс контуром: локатор шире, чем высок, и рисуется им, а не окружностью. */
export function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, width = 1) {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.ellipse(Math.round(x), Math.round(y), rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
}

/** Залитая точка — лампа индикатора. Контур на четырёх пикселях неразличим. */
export function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2)
  ctx.fill()
}

/** Уголки рамки цели. Сплошной прямоугольник заслонял бы саму цель. */
export function corners(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, width = 1) {
  const arm = Math.max(2, size * 0.28)
  const half = size / 2
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cx = x + sx * half
      const cy = y + sy * half
      line(ctx, cx, cy, cx - sx * arm, cy, color, width)
      line(ctx, cx, cy, cx, cy - sy * arm, color, width)
    }
  }
}

export function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  color: string,
  align: CanvasTextAlign = 'left',
) {
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'top'
  ctx.fillText(value, Math.round(x), Math.round(y))
}

/** Горизонтальная шкала: тяга, щит, перегрев. */
export function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fraction: number,
  color: string,
) {
  rect(ctx, x, y, w, h, HUD_COLORS.DIM)
  const filled = Math.round((w - 2) * Math.max(0, Math.min(1, fraction)))
  if (filled > 0) fillRect(ctx, x + 1, y + 1, filled, h - 1, color)
}
