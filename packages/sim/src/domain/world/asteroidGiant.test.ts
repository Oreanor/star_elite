import { describe, expect, it } from 'vitest'
import { ASTEROID } from '../../config/world'
import { createWorld } from './factory'
import { STARTER_SYSTEM } from './system'

describe('гигантские астероиды пояса', () => {
  it('ровно два крупных: ×COLOSSUS и ×GIANT, оба дальше мелочи по масштабу', () => {
    const world = createWorld(STARTER_SYSTEM)
    expect(world.asteroids.length).toBeGreaterThan(2)

    const radii = world.asteroids.map((a) => a.radius).sort((a, b) => b - a)
    const colossus = radii[0]!
    const giant = radii[1]!
    const next = radii[2]!

    expect(colossus).toBeGreaterThanOrEqual(ASTEROID.RADIUS_MIN * ASTEROID.COLOSSUS_SCALE)
    expect(colossus).toBeLessThanOrEqual(ASTEROID.RADIUS_MAX * ASTEROID.COLOSSUS_SCALE + 1e-6)
    expect(giant).toBeGreaterThanOrEqual(ASTEROID.RADIUS_MIN * ASTEROID.GIANT_SCALE)
    expect(giant).toBeLessThanOrEqual(ASTEROID.RADIUS_MAX * ASTEROID.GIANT_SCALE + 1e-6)
    // Исполин на порядок крупнее глыбы; глыба — на порядок крупнее мелочи пояса.
    expect(colossus).toBeGreaterThan(giant * 5)
    expect(giant).toBeGreaterThan(next * 10)

    const big = world.asteroids.filter((a) => a.radius >= ASTEROID.RADIUS_MIN * ASTEROID.GIANT_SCALE)
    expect(big).toHaveLength(2)
  })
})
