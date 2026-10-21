import { describe, expect, it } from 'vitest'
import { Quaternion } from 'three'
import { ARRIVAL, CORE_INDEX, GALAXY, GALAXY_FLIGHT } from '../../config/galaxy'
import { MIELOPHONE } from '../../config/mielophone'
import { catalogLyToWorld, metersPerLy, playerGalaxyLy, preserveGalaxyLocus } from '../scale/scale'
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

/** Ближайшая чужая система дальше `minLy` (по умолчанию три пузыря). */
function neighbourBeyond(world: World, minLy = GALAXY_FLIGHT.BUBBLE_LY * 3): number {
  const here = placeSystem(world.systemIndex, world.galaxySeed)
  const min = minLy
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

  it('вне пузыря маршрут на другую звезду не вешает нав на оставшуюся свою', () => {
    const world = createWorld()
    const planet = world.bodies.find((b) => b.kind === 'planet')
    if (!planet) throw new Error('нужна планета')
    const home = world.systemIndex
    const dest = neighbourBeyond(world)
    world.navTargetId = planet.id
    world.jumpTargetIndex = dest

    const sep = distanceLy(placeSystem(home, world.galaxySeed), placeSystem(dest, world.galaxySeed))
    putAtLy(world, along(home, dest, (GALAXY_FLIGHT.BUBBLE_LY * 1.5) / sep, world.galaxySeed), 1)
    stepGalaxyPresence(world, 1)

    expect(hasPlanets(world)).toBe(false)
    expect(world.jumpTargetIndex).toBe(dest)
    expect(world.navTargetId).toBeNull()
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

  it('на галактическом × ближайшая меняется без пересбора мира', () => {
    // enterSystem на каждом Voronoi дёргал полёт: эпоха, сцена, ноль скорости.
    // Кадр остаётся домом до усадки; индекс ближайшей — только имя/цель.
    const world = createWorld()
    const home = world.systemIndex
    const dest = neighbourBeyond(world)
    const ghost = MIELOPHONE.GHOST_BODY_SCALE
    const far = ghost * 4
    world.player.state.scale = far
    stepGalaxyPresence(world, 1)
    const epoch = world.epoch

    putAtLy(world, placeSystem(dest, world.galaxySeed), far)
    stepGalaxyPresence(world, far)

    expect(world.systemIndex).toBe(dest)
    expect(world.galaxyFrameIndex).toBe(home)
    expect(world.epoch).toBe(epoch)
  })

  it('усадка в 1 св.г. от чужой звезды собирает ЕЁ систему в системных метрах', () => {
    // Баг: усадка с ×20к в 1 св.г. от Ядра оставляла борт в метрах галактического
    // кадра. Дыра висела «в 1000 км» и не приближалась, сопла и пыль дёргались.
    const world = createWorld()
    const home = world.systemIndex
    const dest = neighbourBeyond(world, 3)
    const ghost = MIELOPHONE.GHOST_BODY_SCALE
    const far = ghost * 4
    world.player.state.scale = far
    stepGalaxyPresence(world, 1)

    const homeLy = placeSystem(home, world.galaxySeed)
    const destLy = placeSystem(dest, world.galaxySeed)
    const sep = distanceLy(homeLy, destLy)
    putAtLy(world, along(home, dest, (sep - 1) / sep, world.galaxySeed), far)
    stepGalaxyPresence(world, far)
    expect(world.systemIndex).toBe(dest)
    expect(world.galaxyFrameIndex).toBe(home)

    world.player.state.scale = 1
    stepGalaxyPresence(world, far)

    expect(world.systemIndex).toBe(dest)
    expect(world.galaxyFrameIndex).toBe(dest)
    expect(world.systemName).toBe(generateSystem(dest, world.galaxySeed).name)
    const star = world.bodies.find((b) => b.kind === 'star' || b.kind === 'blackhole')
    expect(star).toBeTruthy()
    const range = world.player.state.pos.distanceTo(star!.pos)
    expect(range).toBeGreaterThan(star!.radius + world.player.spec.hull.radius)
    expect(range).toBeLessThan(
      Math.max(
        metersPerLy(ghost) * GALAXY_FLIGHT.BUBBLE_LY,
        star!.radius + ARRIVAL.STANDOFF * 2,
      ),
    )
  })

  it('усадка в 0.02 св.г. от звезды не кладёт борт внутрь неё', () => {
    // 0.02 св.г на ×20к часто внутри истинного радиуса. Твердь выше GHOST сквозная;
    // усадка её включает — крушение, отскок на корпус (~60 км при ×5к).
    const world = createWorld()
    const home = world.systemIndex
    const dest = neighbourBeyond(world, 3)
    const ghost = MIELOPHONE.GHOST_BODY_SCALE
    const far = ghost * 4
    world.player.state.scale = far
    stepGalaxyPresence(world, 1)

    const homeLy = placeSystem(home, world.galaxySeed)
    const destLy = placeSystem(dest, world.galaxySeed)
    const sep = distanceLy(homeLy, destLy)
    putAtLy(world, along(home, dest, (sep - 0.02) / sep, world.galaxySeed), far)
    stepGalaxyPresence(world, far)

    world.player.state.scale = 1
    stepGalaxyPresence(world, far)

    const star = world.bodies.find((b) => b.kind === 'star' || b.kind === 'blackhole')
    expect(star).toBeTruthy()
    const range = world.player.state.pos.distanceTo(star!.pos)
    const minDist = star!.radius + world.player.spec.hull.radius + ARRIVAL.STANDOFF
    expect(range).toBeGreaterThanOrEqual(minDist * 0.99)
  })

  it('усадка на самой звезде кадра выталкивает на standoff, не внутрь', () => {
    const world = createWorld()
    const ghost = MIELOPHONE.GHOST_BODY_SCALE
    const far = ghost * 4
    world.player.state.scale = far
    stepGalaxyPresence(world, 1)

    putAtLy(world, placeSystem(world.galaxyFrameIndex, world.galaxySeed), far)
    world.player.state.scale = 1
    stepGalaxyPresence(world, far)

    const star = world.bodies.find((b) => b.kind === 'star' || b.kind === 'blackhole')
    expect(star).toBeTruthy()
    const range = world.player.state.pos.distanceTo(star!.pos)
    const minDist = star!.radius + world.player.spec.hull.radius + ARRIVAL.STANDOFF
    expect(range).toBeGreaterThanOrEqual(minDist * 0.99)
    expect(world.galaxyFrameIndex).toBe(world.systemIndex)
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

  it('усадка у системы без планет (Ядро) собирает её один раз, а не каждый такт', () => {
    // «Пузырь загружен» считался по наличию планет. У Ядра их нет — и ниже GHOST
    // присутствие звало прибытие каждый такт: борт прибивало к дыре, сопла дрожали.
    const world = createWorld()
    const big = 1e6
    world.player.state.scale = big
    stepGalaxyPresence(world, 1)
    const core = placeSystem(CORE_INDEX, world.galaxySeed)
    putAtLy(world, { x: core.x + 0.03, y: core.y, z: core.z }, big)

    let s = big
    while (s > 1) {
      const old = s
      s = Math.max(1, s / 1.5)
      preserveGalaxyLocus(world.player, world, old, s)
      world.player.state.scale = s
      stepGalaxyPresence(world, old)
    }
    expect(world.systemIndex).toBe(CORE_INDEX)

    const epoch = world.epoch
    const before = world.player.state.pos.clone()
    for (let i = 0; i < 10; i++) {
      world.player.state.pos.x += 1_000
      stepGalaxyPresence(world, 1)
    }
    expect(world.epoch).toBe(epoch)
    expect(world.player.state.pos.x - before.x).toBeCloseTo(10_000, 0)
  })
})
