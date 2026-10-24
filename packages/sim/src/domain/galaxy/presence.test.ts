import { describe, expect, it } from 'vitest'
import { Quaternion } from 'three'
import { ARRIVAL, CORE_INDEX, GALAXY, GALAXY_FLIGHT } from '../../config/galaxy'
import { MIELOPHONE } from '../../config/mielophone'
import { catalogLyToWorld, metersPerLy, playerGalaxyLy, preserveGalaxyLocus } from '../scale/scale'
import { createWorld, inSystem, makeShip, type World } from '../world'
import { makeRng } from '../../core/math'
import { generateSystem } from './generate'
import { systemDefFor } from './jump'
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

  it('усадка в 1 св.г. от СВОЕЙ звезды подтягивает к пузырю и не пересобирает систему дважды', () => {
    // Подтянутую точку вычисляли и выбрасывали: борт оставался в 1 св.г.·GHOST от дома,
    // систему снимало тактом позже, а дальнейшая усадка собирала её снова.
    const world = createWorld()
    const home = world.systemIndex
    const ghost = MIELOPHONE.GHOST_BODY_SCALE
    const far = ghost * 4
    world.player.state.scale = far
    stepGalaxyPresence(world, 1)

    const homeLy = placeSystem(home, world.galaxySeed)
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const
    let placed = false
    for (const [x, y, z] of dirs) {
      putAtLy(world, { x: homeLy.x + x, y: homeLy.y + y, z: homeLy.z + z }, far)
      if (nearestSystemIndex(world, playerGalaxyLy(world, far), true) === home) {
        placed = true
        break
      }
    }
    expect(placed).toBe(true)

    const epoch = world.epoch
    let s = far
    while (s > 1) {
      const old = s
      s = Math.max(1, s / 1.5)
      preserveGalaxyLocus(world.player, world, old, s)
      world.player.state.scale = s
      stepGalaxyPresence(world, old)
    }
    expect(world.systemIndex).toBe(home)
    expect(world.systemStellarOnly).toBe(false)
    expect(world.epoch - epoch).toBeLessThanOrEqual(1)
    const star = world.bodies.find((b) => b.kind === 'star' || b.kind === 'blackhole')!
    const range = world.player.state.pos.distanceTo(star.pos)
    expect(range).toBeLessThan(metersPerLy(ghost) * GALAXY_FLIGHT.BUBBLE_LY)
  })

  it('ближайшая с кешем перебора — та же, что у полного перебора, на любом блуждании', () => {
    // Кеш пропускает перебор, пока локус не ушёл на полразрыва до второй звезды;
    // ответ обязан совпасть с честным перебором — иначе рассыплется детерминизм.
    const world = createWorld()
    const rng = makeRng(7)
    const brute = (ly: { x: number; y: number; z: number }): number => {
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < GALAXY.COUNT; i++) {
        const d = distanceLy(ly, placeSystem(i, world.galaxySeed))
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      return best
    }
    const ly = { ...placeSystem(world.systemIndex, world.galaxySeed) }
    for (let step = 0; step < 400; step++) {
      const big = rng() < 0.1
      const k = big ? 8 : 0.05
      ly.x += (rng() - 0.5) * k
      ly.y += (rng() - 0.5) * k
      ly.z += (rng() - 0.5) * k * 0.2
      expect(nearestSystemIndex(world, ly, false)).toBe(brute(ly))
    }
  })

  it('прибытие к двойной ставит борт от барицентра: локус не сдвигается на разнос пары', () => {
    // Прежде борт ставился от главной звезды, а локус меряется от барицентра — у двойной
    // сразу после прибытия точка галактики расходилась с той, где борт сжался.
    const world = createWorld()
    const home = world.systemIndex
    let binary = -1
    for (let i = 0; i < GALAXY.COUNT && binary < 0; i++) {
      if (i === home) continue
      if (systemDefFor(i, world.galaxySeed).companion) binary = i
    }
    expect(binary).toBeGreaterThanOrEqual(0)

    const ghost = MIELOPHONE.GHOST_BODY_SCALE
    const far = ghost * 4
    world.player.state.scale = far
    stepGalaxyPresence(world, 1)
    const star = placeSystem(binary, world.galaxySeed)
    putAtLy(world, { x: star.x + 0.03, y: star.y, z: star.z }, far)
    stepGalaxyPresence(world, far)
    const before = { ...playerGalaxyLy(world, far) }

    preserveGalaxyLocus(world.player, world, far, ghost * 0.99)
    world.player.state.scale = ghost * 0.99
    stepGalaxyPresence(world, far)

    expect(world.galaxyFrameIndex).toBe(binary)
    expect(distanceLy(playerGalaxyLy(world, ghost), before)).toBeLessThan(1e-9)
  })
})


describe('зум в пустоте ниже GHOST', () => {
  it('рост и усадка между звёздами не двигают локус: зум — вокруг борта, не вокруг звезды вылета', () => {
    // Пойманное: на ×200–800 в 20 св.г. от звезды вылета локус не вёлся, и ly = (pos−якорь)·S/L
    // растягивался вокруг неё. Цель «ускакивала» с экрана, дистанция прыгала с 25 на 90 св.г.
    const world = createWorld()
    const dest = neighbourBeyond(world, 5)
    const s = 300
    world.player.state.scale = s
    const home = world.systemIndex
    const sep = distanceLy(placeSystem(home, world.galaxySeed), placeSystem(dest, world.galaxySeed))
    // Сначала из пузыря дома — систему снимает до звезды, — потом в пустоту на полпути.
    putAtLy(world, along(home, dest, (GALAXY_FLIGHT.BUBBLE_LY * 2) / sep, world.galaxySeed), s)
    stepGalaxyPresence(world, s)
    expect(world.systemStellarOnly).toBe(true)
    putAtLy(world, along(home, dest, 0.5, world.galaxySeed), s)
    stepGalaxyPresence(world, s)

    const before = { ...playerGalaxyLy(world, s) }
    let old = s
    for (const next of [450, 800, 2000, 120, 7]) {
      preserveGalaxyLocus(world.player, world, old, next)
      world.player.state.scale = next
      stepGalaxyPresence(world, old)
      old = next
      expect(distanceLy(playerGalaxyLy(world, next), before)).toBeLessThan(1e-9)
    }
  })

  it('прибытие в пузырь ниже GHOST не перескакивает к звезде', () => {
    // Борт ставился мерой GHOST, а локус мерился мерой своего роста: на ×500 прибытие
    // сдвигало борт к звезде в S/GHOST раз — из 0.08 св.г. сразу в 0.008.
    const world = createWorld()
    const dest = neighbourBeyond(world, 5)
    const s = 500
    world.player.state.scale = s
    const star = placeSystem(dest, world.galaxySeed)
    putAtLy(world, along(world.systemIndex, dest, 0.9, world.galaxySeed), s)
    stepGalaxyPresence(world, s)
    const at = { x: star.x + GALAXY_FLIGHT.BUBBLE_LY * 0.9, y: star.y, z: star.z }
    catalogLyToWorld(at.x - placeSystem(world.galaxyFrameIndex, world.galaxySeed).x, at.y - placeSystem(world.galaxyFrameIndex, world.galaxySeed).y, at.z - placeSystem(world.galaxyFrameIndex, world.galaxySeed).z, metersPerLy(s), world.player.state.pos)
    world.player.state.pos.sub(world.originOffset)
    stepGalaxyPresence(world, s)
    expect(world.galaxyFrameIndex).toBe(dest)
    expect(distanceLy(playerGalaxyLy(world, s), at)).toBeLessThan(1e-6)
  })
})

describe('своя система при росте ниже GHOST', () => {
  it('у дальних лун система не выгружается от роста: пузырь в св.г. ужимается, орбиты — нет', () => {
    // Пойманное: на ×500 у звезды с лунами на 2000+ св.с пузырь проходил внутри системы — она
    // выгружалась у пилота под носом: радар пустел, цель сбрасывалась на звезду.
    const world = createWorld()
    const star = world.bodies.find((b) => b.kind === 'star')!
    const dir = world.player.state.pos.clone().sub(star.pos).normalize()
    // Дальняя луна на 2400 св.с (как у Праира), борт — рядом с ней, на 2500 св.с.
    const LS = 299_792_458
    const moon = world.bodies.find((x) => x.kind !== 'star')!
    moon.pos.copy(star.pos).addScaledVector(dir, 2400 * LS)
    world.player.state.pos.copy(star.pos).addScaledVector(dir, 2500 * LS)
    const bodies = world.bodies.length
    for (const s of [100, 500, 1000, 2000, 4000]) {
      const old = world.player.state.scale
      world.player.state.scale = s
      stepGalaxyPresence(world, old)
      expect(world.systemStellarOnly).toBe(false)
      expect(world.bodies.length).toBe(bodies)
    }
  })
})

