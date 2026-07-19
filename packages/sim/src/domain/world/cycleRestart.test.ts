import { describe, expect, it } from 'vitest'
import { createWorld, STARTER_SYSTEM, type World } from '.'
import {
  clearContactLock,
  cycleCelestial,
  cycleContact,
  retargetNearestSameClass,
  targetablesOf,
} from './queries'

/** Три врага на разных дистанциях перед носом (−Z). */
function withThreeHostiles(): World {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [
      { count: 1, at: [0, 0, -100], spread: 0, faction: 'hostile', name: 'Пират' },
      { count: 1, at: [0, 0, -400], spread: 0, faction: 'hostile', name: 'Пират' },
      { count: 1, at: [0, 0, -900], spread: 0, faction: 'hostile', name: 'Пират' },
    ],
  })
  world.player.state.pos.set(0, 0, 0)
  return world
}

function byDistance(world: World): number[] {
  const from = world.player.state.pos
  return targetablesOf(world)
    .slice()
    .sort((a, b) => a.state.pos.distanceToSquared(from) - b.state.pos.distanceToSquared(from))
    .map((s) => s.id)
}

describe('свежий Tab-перебор начинается с ближайших', () => {
  it('после паузы снова берёт ближайшего, а не следующего за дальним', () => {
    const world = withThreeHostiles()
    const [near, mid, far] = byDistance(world)
    expect(near).toBeDefined()
    expect(mid).toBeDefined()
    expect(far).toBeDefined()

    cycleContact(world)
    expect(world.lockedTargetId).toBe(near)

    cycleContact(world)
    expect(world.lockedTargetId).toBe(mid)

    cycleContact(world)
    expect(world.lockedTargetId).toBe(far)

    // Пауза дольше CYCLE_RESTART — новый перебор с ближайшего видимого.
    world.time += 2
    cycleContact(world)
    expect(world.lockedTargetId).toBe(near)
  })

  it('быстрые тапы продолжают круг без сброса', () => {
    const world = withThreeHostiles()
    const [near, mid] = byDistance(world)

    cycleContact(world)
    expect(world.lockedTargetId).toBe(near)
    world.time += 0.2
    cycleContact(world)
    expect(world.lockedTargetId).toBe(mid)
  })

  it('новый круг всегда гасит старый фокус', () => {
    const world = withThreeHostiles()
    const planet = world.bodies.find((b) => b.kind === 'planet')
    expect(planet).toBeDefined()

    cycleContact(world)
    expect(world.lockedTargetId).not.toBeNull()
    expect(world.targetFocus).toBe('contact')

    cycleCelestial(world)
    expect(world.navTargetId).not.toBeNull()
    expect(world.targetFocus).toBe('nav')
    expect(world.lockedTargetId).toBeNull()

    cycleContact(world)
    expect(world.lockedTargetId).not.toBeNull()
    expect(world.targetFocus).toBe('contact')
    expect(world.navTargetId).toBeNull()
  })
})

describe('Q — ближайшая цель того же класса', () => {
  it('с борта сбрасывает круг и берёт ближайший борт, не следующий Tab', () => {
    const world = withThreeHostiles()
    const [near, mid, far] = byDistance(world)

    cycleContact(world)
    expect(world.lockedTargetId).toBe(near)
    cycleContact(world)
    expect(world.lockedTargetId).toBe(mid)
    cycleContact(world)
    expect(world.lockedTargetId).toBe(far)

    retargetNearestSameClass(world)
    expect(world.lockedTargetId).toBe(near)
    expect(world.targetFocus).toBe('contact')
  })

  it('с нав-планеты берёт ближайшую планету, не станцию', () => {
    const world = withThreeHostiles()
    const planets = world.bodies
      .filter((b) => b.kind === 'planet')
      .slice()
      .sort(
        (a, b) =>
          a.pos.distanceToSquared(world.player.state.pos) - b.pos.distanceToSquared(world.player.state.pos),
      )
    expect(planets.length).toBeGreaterThanOrEqual(1)
    const station = world.bodies.find((b) => b.kind === 'station')
    expect(station).toBeDefined()

    // Стояли на дальней планете (или единственной) — Q должен вернуть ближайшую планету.
    const farPlanet = planets[planets.length - 1]!
    world.navTargetId = farPlanet.id
    world.targetFocus = 'nav'
    world.lockedStationId = null
    clearContactLock(world)

    retargetNearestSameClass(world)
    expect(world.navTargetId).toBe(planets[0]!.id)
    expect(world.navTargetId).not.toBe(station!.id)
  })

  it('без выбора гасит оба захвата', () => {
    const world = withThreeHostiles()
    world.lockedTargetId = null
    world.lockedPodId = null
    world.lockedAsteroidId = null
    world.navTargetId = null
    world.lockedStationId = null
    retargetNearestSameClass(world)
    expect(world.lockedTargetId).toBeNull()
    expect(world.navTargetId).toBeNull()
  })
})
