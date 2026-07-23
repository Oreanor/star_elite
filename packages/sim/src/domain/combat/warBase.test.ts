import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { MONOLITH } from '../../config/monoliths'
import { WARBASE } from '../../config/warbase'
import { itemMass } from '../cargo/items'
import { createWorld } from '../world'
import { STARTER_SYSTEM } from '../world/system'
import { castLaser } from './raycast'
import { damageWarBase, damageWarBaseFixture, warBaseFixtureWorldPos } from './warBase'

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

describe('отстрел деталей базы', () => {
  it('база рождается с башней и разбросом деталей', () => {
    const world = withBases()
    const base = world.warBases[0]!
    expect(base.fixtures.length).toBeGreaterThanOrEqual(WARBASE.FIXTURES_MIN)
    expect(base.fixtures.length).toBeLessThanOrEqual(WARBASE.FIXTURES_MAX)
    // Ровно одна башня (model 0), и она на полюсе.
    const towers = base.fixtures.filter((f) => f.model === 0)
    expect(towers).toHaveLength(1)
    expect(towers[0]!.dir.y).toBeCloseTo(1, 5)
  })

  it('луч бьёт по ДЕТАЛИ, а не по корпусу, целясь в неё', () => {
    const world = withBases()
    const base = world.warBases[0]!
    const fix = base.fixtures.find((f) => f.model !== 0)!
    const _p = new Vector3()
    warBaseFixtureWorldPos(base, fix, world.time, _p)
    // Стреляем в деталь снаружи, по радиали к центру базы.
    const dir = _p.clone().sub(base.pos).normalize()
    const origin = _p.clone().addScaledVector(dir, fix.size + 500)
    const hit = castLaser(world, origin, dir.clone().negate(), world.player, 5_000)
    expect(hit.warBaseFixture?.fixture.id).toBe(fix.id)
    expect(hit.warBase).toBeNull()
  })

  it('отстрел детали не трогает корпус базы', () => {
    const world = withBases()
    const base = world.warBases[0]!
    const fix = base.fixtures.find((f) => f.model !== 0)!
    const hullBefore = base.hull

    damageWarBaseFixture(world, base, fix, fix.hull)

    expect(fix.alive).toBe(false)
    expect(base.alive).toBe(true)
    expect(base.hull).toBe(hullBefore)
    // Мёртвую деталь луч больше не ловит.
    const _p = new Vector3()
    warBaseFixtureWorldPos(base, fix, world.time, _p)
    const dir = _p.clone().sub(base.pos).normalize()
    const origin = _p.clone().addScaledVector(dir, fix.size + 500)
    const hit = castLaser(world, origin, dir.clone().negate(), world.player, 5_000)
    expect(hit.warBaseFixture?.fixture.id).not.toBe(fix.id)
  })
})
