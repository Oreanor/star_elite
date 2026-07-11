import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { pirateLoadout } from '../../config/loadouts'
import { PLATFORM } from '../../config/platform'
import { createAIState } from '../ai/types'
import { COMMODITIES } from '../cargo/items'
import { castLaser } from '../combat/raycast'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { makeShip } from './factory'
import { spawnPlatform, stepPlatforms } from './platforms'
import type { ShipEntity } from './entities'

/**
 * Платформа-гнездо. Её суть — в том, ЧЕГО не происходит: под маскировкой звено
 * не просыпается, сколько по нему ни стреляй. Поэтому и проверяем прежде всего
 * молчание сенсоров, а уже потом — что открытого игрока гнездо слышит.
 */

/** Пустая система без пояса и патрулей: в кадре только то, что ставит тест. */
function emptyWorld(): World {
  return createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
}

/** Все ли посаженные на палубу пираты ещё спят. */
function allDormant(crew: ShipEntity[]): boolean {
  return crew.every((s) => s.ai?.dormant === true)
}

describe('пиратская платформа-гнездо', () => {
  it('рождается со спящим экипажем на палубе', () => {
    const world = emptyWorld()
    const crew = spawnPlatform(world)

    expect(world.platforms).toHaveLength(1)
    expect(crew.length).toBeGreaterThanOrEqual(PLATFORM.CREW_MIN)
    expect(crew.length).toBeLessThanOrEqual(PLATFORM.CREW_MAX)
    expect(allDormant(crew)).toBe(true)
    // Экипаж — настоящие корабли в общем списке: их можно захватить и расстрелять.
    for (const ship of crew) expect(world.ships).toContain(ship)
  })

  it('под маскировкой гнездо не будится даже вплотную', () => {
    const world = emptyWorld()
    const crew = spawnPlatform(world)
    const platform = world.platforms[0]!

    // Игрок под полем и прямо у палубы — сенсоры платформы его не видят.
    world.player.cloaked = true
    world.player.state.pos.copy(platform.pos)
    stepPlatforms(world, 0.1)

    expect(platform.triggered).toBe(false)
    expect(allDormant(crew)).toBe(true)
  })

  it('под маскировкой обстрел корпуса не будит — спят, пока платформа цела', () => {
    const world = emptyWorld()
    const crew = spawnPlatform(world)
    const platform = world.platforms[0]!

    world.player.cloaked = true
    world.player.state.pos.copy(platform.pos)
    // Задели корпус, но под полем: тревога не проходит.
    platform.hull = platform.maxHull - 100
    stepPlatforms(world, 0.1)

    expect(platform.triggered).toBe(false)
    expect(allDormant(crew)).toBe(true)
  })

  it('открытого игрока ближе WAKE_RANGE гнездо слышит и просыпается', () => {
    const world = emptyWorld()
    const crew = spawnPlatform(world)
    const platform = world.platforms[0]!

    world.player.cloaked = false
    // В километре от ядра — внутри порога пробуждения.
    world.player.state.pos.copy(platform.pos).add(new Vector3(1_000, 0, 0))
    stepPlatforms(world, 0.1)

    expect(platform.triggered).toBe(true)
    expect(crew.every((s) => s.ai?.dormant === false)).toBe(true)
  })

  it('повреждение корпуса поднимает гнездо и вдали (сигнал тревоги)', () => {
    const world = emptyWorld()
    const crew = spawnPlatform(world)
    const platform = world.platforms[0]!

    world.player.cloaked = false
    // Игрок далеко (спавн уносит платформу на километры) — близости нет.
    expect(platform.pos.distanceTo(world.player.state.pos)).toBeGreaterThan(PLATFORM.WAKE_RANGE)
    platform.hull = platform.maxHull - 1
    stepPlatforms(world, 0.1)

    expect(platform.triggered).toBe(true)
    expect(crew.every((s) => s.ai?.dormant === false)).toBe(true)
  })

  it('расстрелянная платформа гибнет, роняет металл ≈ три трюма и добивает спящих', () => {
    const world = emptyWorld()
    const crew = spawnPlatform(world)
    const platform = world.platforms[0]!
    const expected = Math.round(PLATFORM.SCRAP_HOLDS * world.player.hold.capacity)

    platform.hull = 0
    stepPlatforms(world, 0.1)

    expect(platform.alive).toBe(false)
    // Металл: сумма контейнеров ровно на столько трюмов, вещество из ничего не родилось.
    const metal = world.pods
      .filter((p) => p.item.kind === 'commodity' && p.item.commodity.id === COMMODITIES.METALS.id)
      .reduce((sum, p) => sum + (p.item.kind === 'commodity' ? p.item.units : 0), 0)
    expect(metal).toBe(expected)
    // Спавший на борту экипаж сгорел в детонации.
    for (const ship of crew) expect(ship.alive).toBe(false)
  })
})

describe('маскировка бьёт только спящее гнездо', () => {
  /** Пират у −100 по оси взгляда игрока. dormant задаётся вызывающим. */
  function pirateAhead(world: World, dormant: boolean): ShipEntity {
    const ship = makeShip(world.ids, 'hostile', 'Цель', pirateLoadout(), new Vector3(0, 0, -100), new Quaternion(), world.rng)
    ship.ai = createAIState(new Vector3(), world.rng)
    ship.ai.dormant = dormant
    world.ships.push(ship)
    return ship
  }

  it('замаскированный луч добивает спящего', () => {
    const world = emptyWorld()
    const target = pirateAhead(world, true)
    world.player.cloaked = true

    const hit = castLaser(world, new Vector3(0, 0, 0), new Vector3(0, 0, -1), world.player, 1_000)
    expect(hit.ship).toBe(target)
  })

  it('замаскированный луч НЕ трогает бодрствующего', () => {
    const world = emptyWorld()
    pirateAhead(world, false)
    world.player.cloaked = true

    const hit = castLaser(world, new Vector3(0, 0, 0), new Vector3(0, 0, -1), world.player, 1_000)
    expect(hit.ship).toBeNull()
  })

  it('без поля тот же выстрел бьёт бодрствующего — правило только про маскировку', () => {
    const world = emptyWorld()
    const target = pirateAhead(world, false)
    world.player.cloaked = false

    const hit = castLaser(world, new Vector3(0, 0, 0), new Vector3(0, 0, -1), world.player, 1_000)
    expect(hit.ship).toBe(target)
  })

  it('ядро платформы — цель для луча и под полем', () => {
    const world = emptyWorld()
    spawnPlatform(world)
    const platform = world.platforms[0]!
    // Ставим платформу перед носом, ближе экипажа.
    platform.pos.set(0, 0, -300)
    world.player.cloaked = true

    const hit = castLaser(world, new Vector3(0, 0, 0), new Vector3(0, 0, -1), world.player, 1_000)
    expect(hit.platform).toBe(platform)
  })
})
