/**
 * Портрет звезды галактики в клетке HUD: вращающийся шарик с рыбьим глазом.
 * Карта класса — если есть; иначе процедурная плазма того же цвета (не плоский кружок).
 */

import { STAR_CLASSES } from '@elite/sim'
import { starSurfaceUrl } from '../../render/materials/starSurface'
import { drawSampledBall, drawTextureBall, hash2 } from './textureBall'

/** Кипение чуть сильнее шейдера 3D — на 48px иначе не читается. */
const STAR_PAINT = { spin: 0.35, boil: 0.018 } as const

function rgbOf(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255]
}

/** Плазма без webp: гранулы + тёмные пятна, читается как поверхность, не как gradient-кнопка. */
function proceduralPlasma(color: number, seed: number): (u: number, v: number) => [number, number, number] {
  const [br, bg, bb] = rgbOf(color)
  return (u, v) => {
    const g1 = hash2(u * 8, v * 8, seed)
    const g2 = hash2(u * 22, v * 19, seed + 3)
    const spot = hash2(u * 5 + 0.2, v * 5, seed + 7)
    let k = 0.5 + 0.4 * g1 + 0.15 * g2
    if (spot > 0.88) k *= 0.55
    // Полюса чуть светлее — шар читается.
    const pole = Math.abs(v - 0.5) * 2
    k += 0.12 * pole * pole
    return [
      Math.min(255, (br * k + 40 * g2) | 0),
      Math.min(255, (bg * k + 20 * g2) | 0),
      Math.min(255, (bb * k) | 0),
    ]
  }
}

/**
 * Рисует шарик в клетке. Всегда true: карта или процедурная плазма с рыбьим глазом.
 */
export function drawStarBall(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ballR: number,
  colorHex: string,
  classId: string,
  time: number,
): boolean {
  const cls = STAR_CLASSES.find((c) => c.id === classId)
  const colorNum = cls?.color ?? parseInt(colorHex.replace('#', ''), 16)
  // HUD-клетка ~48px — full 1774×887 не нужен.
  const url = starSurfaceUrl(colorNum, 'lo')
  if (url && drawTextureBall(ctx, cx, cy, ballR, colorHex, url, time, STAR_PAINT)) return true
  const seed = (colorNum ^ (classId.charCodeAt(0) << 8)) >>> 0
  drawSampledBall(ctx, cx, cy, ballR, colorHex, time, STAR_PAINT, proceduralPlasma(colorNum, seed))
  return true
}
