import { currentGameDate } from '../clock'
import { moneyNumber } from '../station/Money'
import { HUD_COLORS, ellipse, line, text } from './draw'
import { S, type HudFrame } from './hudShared'

/**
 * Плашка «дата | кошелёк» в левом верхнем углу — та же, что в шапке станции: рамка со
 * скруглением, тёмная подложка, дата тускло, за чертой монетка и сумма белым. Игрок видит
 * один и тот же прибор в полёте и у причала, а не два разных способа сказать «сегодня и
 * сколько денег».
 *
 * Дата — общий календарь (`worldClock`), не `world.time`: HUD, станция и журналы сверяются
 * с одним источником.
 */

/** Подложка — как у станционной плашки (rgba(8,22,42,0.75)). */
const PLATE_FILL = 'rgba(8,22,42,0.75)'
/** Деньги — белым, как `Money` в DOM: сумма читается с одного взгляда. */
const MONEY_TONE = '#ffffff'

export function drawWallet({ ctx, world }: HudFrame): void {
  const date = currentGameDate()
  const money = moneyNumber(world.credits)
  const baseFont = ctx.font
  const boldFont = `bold ${baseFont}`

  const fontPx = Math.round(9 * S)
  const padX = Math.round(6 * S)
  const padY = Math.round(3 * S)
  const gap = Math.round(6 * S) // от текста до черты и от черты до монетки
  const coinW = Math.round(fontPx * 0.6)
  const coinGap = Math.round(3 * S)

  const dateW = Math.ceil(ctx.measureText(date).width)
  ctx.font = boldFont
  const moneyW = Math.ceil(ctx.measureText(money).width)
  ctx.font = baseFont

  const x = Math.round(4 * S)
  const y = Math.round(3 * S)
  const w = padX + dateW + gap + 1 + gap + coinW + coinGap + moneyW + padX
  const h = padY + fontPx + padY

  // Рамка и подложка. Скругление маленькое: на крупном пикселе большое выглядело бы кляксой.
  ctx.beginPath()
  ctx.roundRect(x + 0.5, y + 0.5, w, h, Math.round(3 * S))
  ctx.fillStyle = PLATE_FILL
  ctx.fill()
  ctx.strokeStyle = HUD_COLORS.DIM
  ctx.lineWidth = 1
  ctx.stroke()

  const ty = y + padY
  let cx = x + padX
  text(ctx, date, cx, ty, HUD_COLORS.DIM, 'left')
  cx += dateW + gap
  line(ctx, cx, y + padY - 1, cx, y + h - padY + 1, HUD_COLORS.DIM)
  cx += 1 + gap

  // Монетка — стоячий овал с ребром, как `Coin` в DOM.
  const coinCx = cx + coinW / 2
  const coinCy = ty + fontPx / 2
  ellipse(ctx, coinCx, coinCy, coinW / 2, fontPx / 2, MONEY_TONE, Math.max(1, Math.round(S)))
  ellipse(ctx, coinCx, coinCy, coinW / 4, fontPx / 4, MONEY_TONE, 1)
  cx += coinW + coinGap

  ctx.font = boldFont
  text(ctx, money, cx, ty, MONEY_TONE, 'left')
  ctx.font = baseFont
}
