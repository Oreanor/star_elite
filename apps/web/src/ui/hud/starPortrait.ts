/**
 * Портрет звезды галактики в клетке HUD: вращающийся шарик с картой класса.
 * Без освещения — UV-вращение и кипение, как в starSurface.
 */

import { STAR_CLASSES } from '@elite/sim'
import { starSurfaceUrl } from '../../render/materials/starSurface'
import { drawTextureBall } from './textureBall'

/** Кипение чуть сильнее шейдера 3D — на 48px иначе не читается. */
const STAR_PAINT = { spin: 0.35, boil: 0.018 } as const

/**
 * Рисует шарик в клетке. `ballR` — радиус в пикселях HUD.
 * Нет карты класса → false (зови градиентный фолбэк).
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
  const url = starSurfaceUrl(colorNum)
  if (!url) return false
  return drawTextureBall(ctx, cx, cy, ballR, colorHex, url, time, STAR_PAINT)
}
