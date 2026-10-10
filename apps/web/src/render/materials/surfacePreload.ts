import type { World } from '@elite/sim'
import { pickVariant, planetLook, planetSeed, planetTextureUrl } from '../sky/planets'
import { ROCK_TEXTURE_COUNT, rockTextureUrl } from './rockTextures'
import { preloadSurfaceTexture } from './surfaceTexture'

/**
 * Начать качать карты поверхности системы ДО того, как их попросит сцена.
 *
 * Зовётся там, где система уже известна, а показывать её ещё рано: на титуле (стартовая
 * система) и при открытии портала (система назначения). Иначе карта начинала ехать в
 * момент монтирования тела, и первые секунды в системе планеты стояли плоской покраской,
 * а вкладка планеты показывала голый цветной шар.
 *
 * Камни — все пять разом: ими кроются и астероиды, и луны, и обломки, в любой системе.
 */
export function preloadSystemSurfaces(world: World): void {
  for (let shape = 0; shape < ROCK_TEXTURE_COUNT; shape++) preloadSurfaceTexture(rockTextureUrl(shape))
  for (const body of world.bodies) {
    if (body.kind !== 'planet') continue
    const look = planetLook(body.surface)
    preloadSurfaceTexture(planetTextureUrl(look, pickVariant(look, planetSeed(body.id))))
  }
}
