import { describe, expect, it } from 'vitest'
import { ASTEROID } from '../../config/world'
import { createWorld, STARTER_SYSTEM } from './index'
import {
  liveAsteroidCount,
  spawnAloneAsteroid,
  spawnAsteroidPack,
} from './asteroidEncounter'

describe('встречи с астероидами', () => {
  it('без пояса мир стартует пустым по камням', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    expect(world.asteroids).toHaveLength(0)
  })

  it('одиночка из верхней половины диапазона', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    const rock = spawnAloneAsteroid(world)
    expect(rock).not.toBeNull()
    expect(liveAsteroidCount(world)).toBe(1)
    const lo = ASTEROID.RADIUS_MIN + (ASTEROID.RADIUS_MAX - ASTEROID.RADIUS_MIN) * 0.5
    expect(rock!.radius).toBeGreaterThanOrEqual(lo - 1e-6)
    expect(rock!.radius).toBeLessThanOrEqual(ASTEROID.RADIUS_MAX + 1e-6)
    expect(rock!.radius).toBeGreaterThanOrEqual(ASTEROID.NAV_RADIUS)
  })

  it('стая делит массу крупного, размеры контрастны и в диапазоне', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    const pack = spawnAsteroidPack(world)
    expect(pack.length).toBeGreaterThanOrEqual(2)
    expect(pack.length).toBeLessThanOrEqual(ASTEROID.PACK_MAX)

    const radii = pack.map((a) => a.radius).sort((a, b) => a - b)
    expect(radii[0]!).toBeGreaterThanOrEqual(ASTEROID.RADIUS_MIN - 1e-6)
    expect(radii[radii.length - 1]!).toBeLessThanOrEqual(ASTEROID.RADIUS_MAX + 1e-6)
    // Контраст внутри стаи — иначе «разброс массы» не читается.
    expect(radii[radii.length - 1]! / Math.max(radii[0]!, 1e-6)).toBeGreaterThan(1.5)

    // Суммарный объём стаи порядка объёма одного крупного (не на порядки больше).
    const packVol = pack.reduce((s, a) => s + a.radius ** 3, 0)
    const aloneLo = (ASTEROID.RADIUS_MIN + (ASTEROID.RADIUS_MAX - ASTEROID.RADIUS_MIN) * 0.5) ** 3
    const aloneHi = ASTEROID.RADIUS_MAX ** 3
    expect(packVol).toBeGreaterThan(aloneLo * 0.25)
    expect(packVol).toBeLessThan(aloneHi * 1.5)
  })

  it('диапазон радиусов допускает стократный разброс', () => {
    expect(ASTEROID.RADIUS_MAX / ASTEROID.RADIUS_MIN).toBeGreaterThanOrEqual(100)
  })
})
