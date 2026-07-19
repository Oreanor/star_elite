/**
 * Портрет планеты/луны в клетке HUD: вращающийся шарик с картой типа.
 * Без освещения и без кипения — твёрдая поверхность, только спин + рыбий глаз.
 * То же зерно варианта, что у Bodies (`id * 7919` + pickVariant).
 */

import type { BodyEntity } from '@elite/sim'
import { planetLook, planetTextureUrl, pickVariant } from '../../render/sky/planets'
import { drawSampledBall, drawTextureBall, hash2 } from './textureBall'

/** Медленнее звезды: планета в портрете не должна мельтешить. */
const PLANET_PAINT = { spin: 0.12, boil: 0 } as const

/** То же зерно, что `Planet` в Bodies — одна карта в сцене и в HUD. */
export function planetPortraitSeed(bodyId: number): number {
  return bodyId * 7919
}

function rgbOf(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255]
}

/** Нет jpg — грануляция по цвету тела, чтобы луна/планета не сваливались в плоский диск. */
function proceduralSample(color: number, seed: number): (u: number, v: number) => [number, number, number] {
  const [br, bg, bb] = rgbOf(color)
  return (u, v) => {
    const n = hash2(u * 6, v * 6, seed)
    const crater = hash2(u * 18, v * 18, seed + 1)
    const k = 0.55 + 0.35 * n + (crater > 0.92 ? -0.25 : 0)
    return [
      Math.min(255, (br * k) | 0),
      Math.min(255, (bg * k) | 0),
      Math.min(255, (bb * k) | 0),
    ]
  }
}

/**
 * Рисует шарик планеты или луны. Всегда рисует: карта или процедурный фолбэк.
 */
export function drawPlanetBall(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ballR: number,
  rimColor: string,
  body: BodyEntity,
  time: number,
): void {
  const look = planetLook(body.surface)
  const seed = planetPortraitSeed(body.id)
  const variant = pickVariant(look, seed)
  const url = planetTextureUrl(look, variant)
  if (drawTextureBall(ctx, cx, cy, ballR, rimColor, url, time, PLANET_PAINT)) return
  drawSampledBall(ctx, cx, cy, ballR, rimColor, time, PLANET_PAINT, proceduralSample(body.color, seed))
}
