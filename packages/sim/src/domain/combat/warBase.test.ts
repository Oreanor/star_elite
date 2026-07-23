import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { MONOLITH } from '../../config/monoliths'
import { WARBASE } from '../../config/warbase'
import { itemMass } from '../cargo/items'
import { createWorld } from '../world'
import { STARTER_SYSTEM } from '../world/system'
import { castLaser } from './raycast'
import { damageWarBase } from './warBase'

/** Мир с двумя базами у причала: километровой и трёхкилометровой. */
function withBases(): ReturnType<typeof createWorld> {
  return createWorld({
    ...STARTER_SYSTEM,
    warBases: [
      { name: 'Малая', radius: 1_000, stationOffset: [8_000, 0, 0], model: 0 },
      { name: 'Большая', radius: 3_000, stationOffset: [-12_000, 0, 0], model: 1 },
    ],
  })
}

describe('военная база', () => {
  it('луч попадает в корпус базы', () => {
    const world = withBases()
    const base = world.warBases[0]
    expect(base).toBeDefined()

    const origin = base!.pos.clone().add(new Vector3(0, 0, base!.radius + 200))
    const dir = new Vector3(0, 0, -1)
    const hit = castLaser(world, origin, dir, world.player, 5_000)

    expect(hit.warBase?.id).toBe(base!.id)
    expect(hit.asteroid).toBeNull()
  })

  it('снос сыплет подбираемые осколки с массой', () => {
    const world = withBases()
    const base = world.warBases[0]!
    const beforePods = world.pods.length

    damageWarBase(world, base, base.hull)

    expect(base.alive).toBe(false)
    const debris = world.pods.filter((p) => p.debris)
    expect(debris.length).toBeGreaterThan(beforePods)
    expect(debris.length).toBeGreaterThanOrEqual(MONOLITH.ROCK_DEBRIS_MIN)
    expect(debris.length).toBeLessThanOrEqual(MONOLITH.ROCK_DEBRIS_MAX)
    for (const pod of debris) {
      expect(pod.debris!.shape).toBe(base.shape)
      expect(itemMass(pod.item)).toBeGreaterThan(0)
      expect(pod.item.kind).toBe('commodity')
    }
  })

  it('крупная база сыплет не меньше осколков, чем малая', () => {
    const world = withBases()
    const small = world.warBases.reduce((a, b) => (a.radius <= b.radius ? a : b))
    const large = world.warBases.reduce((a, b) => (a.radius >= b.radius ? a : b))
    expect(large.radius).toBeGreaterThan(small.radius)

    damageWarBase(world, small, small.hull)
    const smallN = world.pods.filter((p) => p.debris).length
    world.pods = []

    expect(large.alive).toBe(true)
    damageWarBase(world, large, large.hull)
    const largeN = world.pods.filter((p) => p.debris).length

    expect(largeN).toBeGreaterThanOrEqual(smallN)
  })

  it('прочность корпуса растёт с радиусом', () => {
    const world = withBases()
    const small = world.warBases.reduce((a, b) => (a.radius <= b.radius ? a : b))
    const large = world.warBases.reduce((a, b) => (a.radius >= b.radius ? a : b))
    expect(large.hull).toBeGreaterThan(small.hull)
    expect(small.hull).toBeCloseTo(WARBASE.HULL_PER_KM * (small.radius / 1000), 5)
  })
})
