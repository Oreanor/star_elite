import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { ASTEROID_BELT } from '../../config/world'
import { GALAXY } from '../../config/galaxy'
import { systemDefFor } from '../galaxy/jump'
import { createWorld } from './factory'
import { beltNearest, insideBelt, stepBelts } from './belts'
import type { World } from './entities'

/**
 * Пояса астероидов: из зерна, в просвете между орбитами, и живут камнями, пока ты внутри.
 * Свойства, а не числа.
 */

/** Первая система галактики с поясом — какая именно, неважно. */
function beltSystem(): number {
  for (let i = 1; i < GALAXY.COUNT; i++) if ((systemDefFor(i, GALAXY.SEED).asteroidBelts ?? []).length > 0) return i
  throw new Error('нет системы с поясом')
}

function worldWithBelt(): World {
  const world = createWorld(systemDefFor(beltSystem(), GALAXY.SEED))
  world.asteroids.length = 0
  return world
}

describe('пояса астероидов', () => {
  it('одно зерно — те же пояса', () => {
    const i = beltSystem()
    expect(systemDefFor(i, GALAXY.SEED).asteroidBelts).toEqual(systemDefFor(i, GALAXY.SEED).asteroidBelts)
  })

  it('доля систем с поясом близка к заданной', () => {
    let withBelt = 0
    let withPlanets = 0
    for (let i = 1; i < 600; i++) {
      const def = systemDefFor(i, GALAXY.SEED)
      if (def.planets.length === 0) continue
      withPlanets++
      if ((def.asteroidBelts ?? []).length > 0) withBelt++
    }
    expect(withBelt / withPlanets).toBeGreaterThan(ASTEROID_BELT.CHANCE * 0.6)
    expect(withBelt / withPlanets).toBeLessThan(ASTEROID_BELT.CHANCE * 1.4)
  })

  /** Кольцо не задевает планеты: ни одна орбита не проходит сквозь его ширину. */
  it('пояс лежит в просвете — орбиты планет вне кольца', () => {
    for (let i = 1; i < 400; i++) {
      const def = systemDefFor(i, GALAXY.SEED)
      for (const belt of def.asteroidBelts ?? []) {
        for (const p of def.planets) {
          const orbit = Math.hypot(p.pos[0], p.pos[2])
          expect(Math.abs(orbit - belt.radius)).toBeGreaterThan(belt.width / 2)
        }
      }
    }
  })

  it('внутри — расстояние ноль, снаружи — до ближайшей кромки', () => {
    const world = worldWithBelt()
    const belt = world.asteroidBelts[0]!
    const star = world.bodies.find((b) => b.id === belt.centerId)!
    const inside = star.pos.clone().add(new Vector3(belt.radius, 0, 0))
    expect(insideBelt(world, belt, inside)).toBe(true)
    expect(beltNearest(world, belt, inside, new Vector3())).toBeCloseTo(0, 3)
    const outside = star.pos.clone().add(new Vector3(belt.radius + belt.width, 0, 0))
    expect(insideBelt(world, belt, outside)).toBe(false)
    expect(beltNearest(world, belt, outside, new Vector3())).toBeCloseTo(belt.width / 2, 0)
  })

  it('в поясе вокруг корабля родятся камни, вне — нет', () => {
    const world = worldWithBelt()
    const belt = world.asteroidBelts[0]!
    const star = world.bodies.find((b) => b.id === belt.centerId)!
    world.player.state.pos.copy(star.pos).add(new Vector3(0, 0, belt.radius))
    for (let t = 0; t < ASTEROID_BELT.SPAWN_INTERVAL * 3; t += 1 / 60) stepBelts(world, 1 / 60)
    expect(world.asteroids.filter((a) => a.alive).length).toBeGreaterThan(0)

    const empty = worldWithBelt()
    for (let t = 0; t < ASTEROID_BELT.SPAWN_INTERVAL * 3; t += 1 / 60) stepBelts(empty, 1 / 60)
    expect(empty.asteroids.length).toBe(0)
  })
})
