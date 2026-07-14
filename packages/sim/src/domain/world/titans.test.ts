import { describe, expect, it } from 'vitest'
import { TITAN } from '../../config/titans'
import { applyDamage } from '../combat/damage'
import { createWorld, enterSystem, STARTER_SYSTEM, type World } from './index'
import { placeShowcaseTitans, spawnTitan, spawnTrafficTitan, stepTitans, titanCount } from './titans'

/**
 * Киты — корабли поколений.
 *
 * Декорация: они не в `ships` и не в `bodies`, поэтому боевая машинерия их не
 * видит вовсе. Проверяем именно это — что кит живёт мимо боя, — а не числа.
 */

const quiet = (): World => createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })

describe('киты', () => {
  it('рождаются в своём списке, а не среди кораблей или тел', () => {
    const world = quiet()
    const before = { ships: world.ships.length, bodies: world.bodies.length }
    const titan = spawnTitan(world)

    expect(world.titans).toContain(titan)
    expect(world.ships.length).toBe(before.ships)
    expect(world.bodies.length).toBe(before.bodies)
    expect(titan.kind).toBe('titan')
  })

  it('облик берётся из таблицы видов, а не выходит за неё', () => {
    const world = quiet()
    for (let i = 0; i < 50; i++) {
      const titan = spawnTitan(world)
      expect(titan.variant).toBeGreaterThanOrEqual(0)
      expect(titan.variant).toBeLessThan(TITAN.VARIANTS)
      world.titans.length = 0
    }
  })

  it('из трафика висит у станции без дрейфа', () => {
    const world = quiet()
    const station = world.bodies.find((b) => b.kind === 'station')!
    const titan = spawnTrafficTitan(world)

    expect(titan.vel.lengthSq()).toBe(0)
    const hang = titan.pos.distanceTo(station.pos)
    expect(hang).toBeGreaterThan(TITAN.RADIUS * TITAN.STATION_HANG_MIN)
    expect(hang).toBeLessThan(TITAN.RADIUS * TITAN.STATION_HANG_MAX * 1.05)
  })

  it('дрейфует по своей скорости и исчезает, уйдя за горизонт', () => {
    const world = quiet()
    const titan = spawnTitan(world)
    titan.pos.copy(world.player.state.pos)
    titan.pos.x += 100
    titan.vel.set(50, 0, 0)

    const start = titan.pos.x
    stepTitans(world, 2)
    expect(titan.pos.x).toBeCloseTo(start + 100, 3)

    titan.pos.x = world.player.state.pos.x + TITAN.DESPAWN_RANGE + 1
    stepTitans(world, 0)
    expect(world.titans).not.toContain(titan)
  })

  it('неуязвим: боевая машинерия его не касается', () => {
    const world = quiet()
    const titan = spawnTitan(world)

    // @ts-expect-error — кит не корабль, урон ему нанести нечем, и это гарантия типа.
    expect(() => applyDamage(titan, 1_000_000, world.time)).not.toThrow()
    expect(world.titans).toContain(titan)
    expect('hull' in titan).toBe(false)
    expect('shield' in titan).toBe(false)
  })

  it('прыжок в новую систему уносит китов прежней', () => {
    const world = quiet()
    spawnTrafficTitan(world)
    expect(titanCount(world)).toBeGreaterThan(0)

    enterSystem(world, { ...STARTER_SYSTEM, patrols: [], belt: null }, world.systemIndex + 1)
    expect(titanCount(world)).toBe(0)
  })

  it('в новой игре китов нет — только редкий трафик', () => {
    const world = quiet()
    expect(world.titans).toHaveLength(0)
  })

  it('экспонаты выставляют все облики по запросу', () => {
    const world = quiet()
    placeShowcaseTitans(world)
    const variants = new Set(world.titans.map((t) => t.variant))
    expect(world.titans.length).toBe(TITAN.VARIANTS)
    expect(variants.size).toBe(TITAN.VARIANTS)
  })
})
