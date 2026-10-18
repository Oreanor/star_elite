import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { ASTEROID_BELT } from '../../config/world'
import { GALAXY } from '../../config/galaxy'
import { systemDefFor } from '../galaxy/jump'
import { createWorld } from './factory'
import { beltNearest, beltRockKey, beltRocks, insideBelt, stepBelts } from './belts'
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

  /** Подлететь вплотную к камню пояса номер `i` и дать поясу пару проверок. */
  function nearRock(world: World, i: number): Vector3 {
    const belt = world.asteroidBelts[0]!
    const star = world.bodies.find((b) => b.id === belt.centerId)!
    const r = beltRocks(belt)[i]!
    const at = star.pos.clone().add(new Vector3(r.x, r.y, r.z))
    world.player.state.pos.copy(at).add(new Vector3(0, 0, 2_000))
    for (let t = 0; t < ASTEROID_BELT.SCAN_INTERVAL * 3; t += 1 / 60) stepBelts(world, 1 / 60)
    return at
  }

  it('одно зерно — те же камни пояса, на своих местах', () => {
    const a = worldWithBelt().asteroidBelts[0]!
    const b = worldWithBelt().asteroidBelts[0]!
    expect(beltRocks(a)).toEqual(beltRocks(b))
    expect(beltRocks(a).length).toBe(ASTEROID_BELT.ROCKS)
  })

  // Пойманное: пояс был облаком точек-картинки, а камни рождались случайно вокруг корабля —
  // подлетал к точке, она таяла, а камня там не было. Теперь точка и тело — одно место.
  it('подлетел к точке пояса — там этот самый камень, телом мира', () => {
    const world = worldWithBelt()
    const at = nearRock(world, 7)
    const key = beltRockKey(0, 7)
    const body = world.asteroids.find((a) => a.beltKey === key)
    expect(body).toBeDefined()
    expect(body!.pos.distanceTo(at)).toBeLessThan(1)
    expect(body!.radius).toBeCloseTo(beltRocks(world.asteroidBelts[0]!)[7]!.radius, 3)
  })

  // Пойманное: 2400 одиночек по кольцу в сотни миллионов км стояли в среднем в 300 тысячах км
  // друг от друга — влетел в полосу, а она рассыпалась в пустоту. Камни лежат полями.
  it('камни пояса лежат скоплениями: у каждого есть сосед в пределах поля', () => {
    const rocks = beltRocks(worldWithBelt().asteroidBelts[0]!)
    let lonely = 0
    for (let i = 0; i < rocks.length; i += 37) {
      const a = rocks[i]!
      const near = rocks.some((b, j) => j !== i && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < ASTEROID_BELT.CLUSTER_SPREAD * 2)
      if (!near) lonely++
    }
    expect(lonely).toBe(0)
  })

  it('вдали от кольца камни телами не рождаются', () => {
    const world = worldWithBelt()
    for (let t = 0; t < ASTEROID_BELT.SCAN_INTERVAL * 3; t += 1 / 60) stepBelts(world, 1 / 60)
    expect(world.asteroids.length).toBe(0)
  })

  it('сбитый камень пояса не возвращается; улетевший — возвращается тем же', () => {
    const world = worldWithBelt()
    nearRock(world, 3)
    const key = beltRockKey(0, 3)
    const rock = world.asteroids.find((a) => a.beltKey === key)!
    // Улетели: уборка унесла живое тело — камень остаётся в поясе.
    world.asteroids.length = 0
    stepBelts(world, 1 / 60)
    expect(world.beltGone.has(key)).toBe(false)
    nearRock(world, 3)
    expect(world.asteroids.some((a) => a.beltKey === key)).toBe(true)
    // Сбили — больше не рождается.
    world.asteroids.find((a) => a.beltKey === key)!.alive = false
    void rock
    stepBelts(world, 1 / 60)
    world.asteroids.length = 0
    nearRock(world, 3)
    expect(world.beltGone.has(key)).toBe(true)
    expect(world.asteroids.some((a) => a.beltKey === key)).toBe(false)
  })
})
