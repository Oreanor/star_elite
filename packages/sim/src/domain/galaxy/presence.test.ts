import { describe, expect, it } from 'vitest'
import { Quaternion } from 'three'
import { GALAXY, GALAXY_FLIGHT } from '../../config/galaxy'
import { MIELOPHONE } from '../../config/mielophone'
import { catalogLyToWorld, metersPerLy, playerGalaxyLy } from '../scale/scale'
import { createWorld, inSystem, makeShip, type World } from '../world'
import { generateSystem } from './generate'
import { nearestSystemIndex, stepGalaxyPresence } from './presence'
import { distanceLy, placeSystem } from './shape'

/**
 * Связное пространство: текущая система — ближайшая звезда, тела живут только
 * внутри BUBBLE_LY, цель с карты галактики не сбрасывается по пути.
 */

function hasPlanets(world: World): boolean {
  return world.bodies.some((b) => b.kind === 'planet' || b.kind === 'moon' || b.kind === 'station')
}

function putAtLy(world: World, ly: { x: number; y: number; z: number }, scale: number): void {
  world.player.state.scale = scale
  const origin = placeSystem(world.galaxyFrameIndex, world.galaxySeed)
  catalogLyToWorld(
    ly.x - origin.x,
    ly.y - origin.y,
    ly.z - origin.z,
    metersPerLy(scale),
    world.player.state.pos,
  )
  const star = world.bodies.find((b) => b.kind === 'star' || b.kind === 'blackhole')
  if (star) world.player.state.pos.add(star.pos)
}

function along(from: number, to: number, t: number, seed: number): { x: number; y: number; z: number } {
  const a = placeSystem(from, seed)
  const b = placeSystem(to, seed)
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
}

/** Ближайшая чужая система дальше трёх пузырей — чтобы путь «вышел → вошёл» не схлопнулся. */
function neighbourBeyond(world: World): number {
  const here = placeSystem(world.systemIndex, world.galaxySeed)
  const min = GALAXY_FLIGHT.BUBBLE_LY * 3
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < GALAXY.COUNT; i++) {
    if (i === world.systemIndex) continue
    const d = distanceLy(here, placeSystem(i, world.galaxySeed))
    if (d < min) continue
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  if (best < 0) throw new Error('нет соседа за пределами пузыря')
  return best
}

describe('связное пространство', () => {
  it('на галактическом × пилот уже не в системе, хотя тела ещё в кадре', () => {
    const world = createWorld()
    expect(inSystem(world)).toBe(true)
    world.player.state.scale = MIELOPHONE.GHOST_BODY_SCALE
    expect(inSystem(world)).toBe(false)
  })

  it('рост через GHOST_BODY сбрасывает захват, но не звезду с карты', () => {
    const world = createWorld()
    const planet = world.bodies.find((b) => b.kind === 'planet')
    if (!planet) throw new Error('нужна планета')
    const route = neighbourBeyond(world)
    world.navTargetId = planet.id
    world.targetFocus = 'nav'
    world.jumpTargetIndex = route

    const ghost = MIELOPHONE.GHOST_BODY_SCALE
    world.player.state.scale = ghost
    stepGalaxyPresence(world, 1)

    expect(world.navTargetId).toBeNull()
    expect(world.jumpTargetIndex).toBe(route)
    expect(world.galaxyFrameIndex).toBe(world.systemIndex)
  })

  it('вне пузыря ближайшей остаются только звезда / дыра', () => {
    const world = createWorld()
    const home = world.systemIndex
    const nbr = neighbourBeyond(world)
    const passer = makeShip(
      world.ids,
      'hostile',
      'Пират',
      world.player.loadout,
      world.player.state.pos.clone(),
      new Quaternion(),
      world.rng,
    )
    world.ships.push(passer)
    const sep = distanceLy(placeSystem(home, world.galaxySeed), placeSystem(nbr, world.galaxySeed))
    const t = (GALAXY_FLIGHT.BUBBLE_LY * 1.5) / sep
    putAtLy(world, along(home, nbr, t, world.galaxySeed), 1)
    stepGalaxyPresence(world, 1)

    expect(hasPlanets(world)).toBe(false)
    expect(inSystem(world)).toBe(false)
    expect(world.bodies.some((b) => b.kind === 'star' || b.kind === 'blackhole')).toBe(true)
    expect(world.systemIndex).toBe(home)
    // Трафик в пустоте не снимаем: карта системы гаснет, борта — нет.
    expect(world.ships.some((s) => s.id === passer.id)).toBe(true)
  })

  it('вход в пузырь соседа рисует ЕГО систему, цель с карты живёт', () => {
    const world = createWorld()
    const home = world.systemIndex
    const nbr = neighbourBeyond(world)
    const far = nbr === 0 ? GALAXY.COUNT - 1 : 0
    world.jumpTargetIndex = far === home ? far + 2 : far

    const sep = distanceLy(placeSystem(home, world.galaxySeed), placeSystem(nbr, world.galaxySeed))
    putAtLy(world, along(home, nbr, (GALAXY_FLIGHT.BUBBLE_LY * 1.5) / sep, world.galaxySeed), 1)
    stepGalaxyPresence(world, 1)
    expect(hasPlanets(world)).toBe(false)

    putAtLy(world, along(home, nbr, 1 - (GALAXY_FLIGHT.BUBBLE_LY * 0.5) / sep, world.galaxySeed), 1)
    stepGalaxyPresence(world, 1)

    expect(world.systemIndex).toBe(nbr)
    expect(hasPlanets(world)).toBe(true)
    expect(world.systemName).toBe(generateSystem(nbr, world.galaxySeed).name)
    expect(world.jumpTargetIndex).toBe(far === home ? far + 2 : far)
  })

  it('цель с карты гаснет, только войдя в ЕЁ пузырь', () => {
    const world = createWorld()
    const home = world.systemIndex
    const dest = neighbourBeyond(world)
    world.jumpTargetIndex = dest

    const sep = distanceLy(placeSystem(home, world.galaxySeed), placeSystem(dest, world.galaxySeed))
    putAtLy(world, along(home, dest, (GALAXY_FLIGHT.BUBBLE_LY * 1.5) / sep, world.galaxySeed), 1)
    stepGalaxyPresence(world, 1)
    expect(world.jumpTargetIndex).toBe(dest)

    putAtLy(world, along(home, dest, 1 - (GALAXY_FLIGHT.BUBBLE_LY * 0.5) / sep, world.galaxySeed), 1)
    stepGalaxyPresence(world, 1)

    expect(world.systemIndex).toBe(dest)
    expect(world.jumpTargetIndex).toBeNull()
  })

  it('усадка ниже GHOST_BODY у чужой звезды собирает её, а не дом', () => {
    const world = createWorld()
    const nbr = neighbourBeyond(world)
    const ghost = MIELOPHONE.GHOST_BODY_SCALE
    world.player.state.scale = ghost
    stepGalaxyPresence(world, 1)

    putAtLy(world, placeSystem(nbr, world.galaxySeed), ghost)
    stepGalaxyPresence(world, ghost)
    expect(world.systemIndex).toBe(nbr)

    world.player.state.scale = 1
    stepGalaxyPresence(world, ghost)

    expect(world.systemIndex).toBe(nbr)
    expect(world.galaxyFrameIndex).toBe(nbr)
    expect(hasPlanets(world)).toBe(true)
    expect(world.systemName).toBe(generateSystem(nbr, world.galaxySeed).name)
  })

  it('тела есть только у ближайшей и только внутри пузыря', () => {
    const world = createWorld()
    const home = world.systemIndex
    const nbr = neighbourBeyond(world)

    putAtLy(world, along(home, nbr, 0.5, world.galaxySeed), 1)
    stepGalaxyPresence(world, 1)

    const ly = playerGalaxyLy(world, 1)
    const nearest = nearestSystemIndex(world, ly, false)
    const dist = distanceLy(ly, placeSystem(nearest, world.galaxySeed))
    if (hasPlanets(world)) {
      expect(dist).toBeLessThan(GALAXY_FLIGHT.BUBBLE_LY * 1.2)
      expect(world.systemIndex).toBe(nearest)
    } else {
      expect(dist).toBeGreaterThan(GALAXY_FLIGHT.BUBBLE_LY)
    }
  })
})
