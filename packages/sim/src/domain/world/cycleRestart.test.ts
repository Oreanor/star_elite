import { describe, expect, it } from 'vitest'
import { createWorld, STARTER_SYSTEM, type World } from '.'
import {
  cycleCelestial,
  cycleContact,
  retargetNearestCelestial,
  retargetNearestContact,
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

describe('Q / Shift+Q — ближайшая из круга Tab / Shift+Tab', () => {
  it('Q с середины круга Tab берёт ближайший контакт, не следующий Tab', () => {
    const world = withThreeHostiles()
    const [near, mid, far] = byDistance(world)

    cycleContact(world)
    expect(world.lockedTargetId).toBe(near)
    cycleContact(world)
    expect(world.lockedTargetId).toBe(mid)
    cycleContact(world)
    expect(world.lockedTargetId).toBe(far)

    retargetNearestContact(world)
    expect(world.lockedTargetId).toBe(near)
    expect(world.targetFocus).toBe('contact')
  })

  it('Shift+Q берёт ближайшее из небесного круга (голова Shift+Tab)', () => {
    const world = withThreeHostiles()
    cycleCelestial(world)
    const first = world.navTargetId
    expect(first).not.toBeNull()
    cycleCelestial(world)
    expect(world.navTargetId).not.toBe(first)

    retargetNearestCelestial(world)
    expect(world.navTargetId).toBe(first)
    expect(world.targetFocus).toBe('nav')
    expect(world.lockedTargetId).toBeNull()
  })

  it('Q без контактов гасит контактный захват, нав не трогает', () => {
    const world = withThreeHostiles()
    // Убрать всех контактов: перебить патрули нельзя просто так — гасим через clear и пустой круг.
    for (const s of targetablesOf(world)) s.alive = false
    world.pods.length = 0
    world.asteroids.length = 0
    world.lockedTargetId = 1
    world.lockedPodId = null
    world.lockedAsteroidId = null
    cycleCelestial(world)
    const nav = world.navTargetId
    expect(nav).not.toBeNull()

    retargetNearestContact(world)
    expect(world.lockedTargetId).toBeNull()
    expect(world.navTargetId).toBe(nav)
  })
})
