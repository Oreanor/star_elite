import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { GRAVITY } from '../../config/bodies'
import { CRUISE } from '../../config/cruise'
import { createWorld, STARTER_SYSTEM } from '../world'
import type { World } from '../world/entities'
import { isPhased, updateCruise } from './drive'

/** Астрономическая единица, м. Та же, что в описании системы. */
const AU = 149_597_870_700

function emptySystem(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

/** Гонит привод `seconds` секунд с постоянным желанием. */
function spool(world: World, want: boolean, seconds: number): void {
  const dt = 1 / 120
  for (let i = 0; i < seconds * 120; i++) updateCruise(world.player, world, want, dt)
}

/**
 * Уносит игрока в межпланетную пустоту, где полный ход разрешён.
 *
 * Две а.е. «вверх» от плоскости системы: звёздный потолок здесь уже полный.
 */
function toDeepSpace(world: World): void {
  world.player.state.pos.set(0, 2 * AU, 0)
}

describe('крейсерский привод', () => {
  it('в пустоте разгоняется до предела', () => {
    const world = emptySystem()
    toDeepSpace(world)
    spool(world, true, 30)
    expect(world.player.cruise.factor).toBeGreaterThan(CRUISE.MAX_FACTOR * 0.95)
    expect(world.player.cruise.block).toBeNull()
  })

  it('пишет множитель прямо в controls: физика не знает о режимах', () => {
    const world = emptySystem()
    toDeepSpace(world)
    spool(world, true, 10)
    expect(world.player.controls.cruise).toBe(world.player.cruise.factor)
  })

  it('после отпускания скорость падает быстрее, чем набиралась', () => {
    const world = emptySystem()
    toDeepSpace(world)
    spool(world, true, 30)
    const peak = world.player.cruise.factor

    spool(world, false, 2)
    const afterRelease = world.player.cruise.factor

    // За те же 2 секунды разгон от единицы поднимает куда меньше, чем падает спад.
    expect(afterRelease).toBeLessThan(peak * 0.2)
  })

  it('возвращается ровно к единице, а не к числовому шуму', () => {
    const world = emptySystem()
    toDeepSpace(world)
    spool(world, true, 20)
    spool(world, false, 15)
    expect(world.player.cruise.factor).toBe(1)
    expect(isPhased(world.player)).toBe(false)
  })

  it('ретро рубит множитель сразу, без экспоненциального спада', () => {
    // Ctrl должен мгновенно гасить форсаж: спад DECAY_RATE с ×40M — секунды «выхода».
    const world = emptySystem()
    toDeepSpace(world)
    spool(world, true, 30)
    expect(world.player.cruise.factor).toBeGreaterThan(CRUISE.MAX_FACTOR * 0.95)

    world.player.controls.retro = 1
    updateCruise(world.player, world, true, 1 / 120) // даже если пробел ещё зажат
    expect(world.player.cruise.factor).toBe(1)
    expect(world.player.controls.cruise).toBe(1)
    expect(world.player.cruise.engaged).toBe(false)
  })

  it('защёлка (число) держит множитель: не растёт к MAX и не тает', () => {
    const world = emptySystem()
    toDeepSpace(world)
    spool(world, true, 8)
    const held = world.player.cruise.factor
    expect(held).toBeGreaterThan(10)
    expect(held).toBeLessThan(CRUISE.MAX_FACTOR * 0.5)

    spool(world, held, 5) // «want» = замороженный множитель
    expect(world.player.cruise.factor).toBe(held)
    expect(world.player.cruise.engaged).toBe(true)
  })
})

describe('массовая блокировка', () => {
  /** Без неё любой бой заканчивается мгновенным побегом — и боя нет. */
  it('враг рядом не даёт разогнаться', () => {
    const world = createWorld({
      ...STARTER_SYSTEM,
      belt: null,
      patrols: [{ count: 1, at: [0, 0, -300], spread: 0, faction: 'hostile', name: 'Пират' }],
    })
    // В пустоте, где потолок близости не мешает: держит именно враг.
    toDeepSpace(world)
    world.ships[0]!.state.pos.copy(world.player.state.pos).add(new Vector3(0, 0, -300))

    spool(world, true, 10)
    expect(world.player.cruise.factor).toBe(1)
    expect(world.player.cruise.block).toBe('mass-lock')
  })

  it('за пределами блокировки разгон снова возможен', () => {
    const world = createWorld({
      ...STARTER_SYSTEM,
      belt: null,
      patrols: [{ count: 1, at: [0, 0, -300], spread: 0, faction: 'hostile', name: 'Пират' }],
    })
    toDeepSpace(world)
    world.ships[0]!.state.pos.copy(world.player.state.pos).add(new Vector3(0, 0, -CRUISE.MASS_LOCK_RANGE * 2))

    spool(world, true, 10)
    expect(world.player.cruise.factor).toBeGreaterThan(2)
    expect(world.player.cruise.block).toBeNull()
  })

  it('погибший враг больше не держит', () => {
    const world = createWorld({
      ...STARTER_SYSTEM,
      belt: null,
      patrols: [{ count: 1, at: [0, 0, -300], spread: 0, faction: 'hostile', name: 'Пират' }],
    })
    toDeepSpace(world)
    world.ships[0]!.state.pos.copy(world.player.state.pos).add(new Vector3(0, 0, -300))
    world.ships[0]!.alive = false

    spool(world, true, 10)
    expect(world.player.cruise.block).toBeNull()
  })
})

describe('ограничение у звезды', () => {
  it('планета не тормозит включённый крейсер', () => {
    const world = emptySystem()
    const planet = world.bodies.find((b) => b.kind === 'planet')!
    world.player.state.pos.copy(planet.pos).add(new Vector3(0, 0, planet.radius + 200))

    spool(world, true, 10)
    expect(world.player.cruise.factor).toBeGreaterThan(1000)
    expect(world.player.cruise.block).toBeNull()
  })

  it('станция не тормозит включённый крейсер', () => {
    const world = emptySystem()
    spool(world, true, 10)

    expect(world.player.cruise.factor).toBeGreaterThan(1000)
    expect(world.player.cruise.block).toBeNull()
  })

  it('чёрная дыра не тормозит включённый крейсер', () => {
    const world = emptySystem()
    const hole = world.bodies.find((body) => body.kind === 'star')!
    hole.kind = 'blackhole'
    world.player.state.pos.copy(hole.pos).add(new Vector3(hole.radius + 100, 0, 0))

    spool(world, true, 10)

    expect(world.player.cruise.factor).toBeGreaterThan(1000)
    expect(world.player.cruise.block).toBeNull()
  })

  it('звезда не тормозит игрока с другого конца системы', () => {
    const world = emptySystem()
    const star = world.bodies.find((b) => b.kind === 'star')!
    // Две а.е. от звезды — это далеко даже по меркам звезды.
    world.player.state.pos.copy(star.pos).add(new Vector3(0, 2 * AU, 0))

    spool(world, true, 40)
    expect(world.player.cruise.factor).toBeGreaterThan(CRUISE.MAX_FACTOR * 0.9)
  })

  it('перед границей притяжения звезды привод начинает выход к единице', () => {
    const world = emptySystem()
    const star = world.bodies.find((b) => b.kind === 'star')!
    const gravityEdge = star.radius * GRAVITY.REACH_RADII
    const buffer = star.radius * CRUISE.STAR_EXIT_BUFFER_RADII
    world.player.state.pos.copy(star.pos).add(new Vector3(star.radius + gravityEdge + buffer - 1, 0, 0))

    spool(world, true, 10)

    expect(world.player.cruise.factor).toBe(1)
    expect(isPhased(world.player)).toBe(false)
    expect(world.player.cruise.block).toBe('proximity')
  })

  it('с полного хода успевает выйти из крейсера до начала притяжения', () => {
    const world = emptySystem()
    const ship = world.player
    const star = world.bodies.find((body) => body.kind === 'star')!
    const gravityEdge = star.radius * GRAVITY.REACH_RADII
    const buffer = star.radius * CRUISE.STAR_EXIT_BUFFER_RADII
    const fullSpeed = ship.spec.tuning.MAX_SPEED * CRUISE.MAX_FACTOR
    const brakingDistance = fullSpeed / CRUISE.DECAY_RATE
    ship.state.pos.copy(star.pos).add(new Vector3(
      star.radius + gravityEdge + buffer + brakingDistance - 100,
      0,
      0,
    ))
    ship.state.vel.set(-fullSpeed, 0, 0)
    ship.cruise.factor = CRUISE.MAX_FACTOR

    const dt = 1 / 120
    for (let i = 0; i < 20 / dt; i++) {
      updateCruise(ship, world, true, dt)
      const speed = Math.min(-ship.state.vel.x, ship.spec.tuning.MAX_SPEED * ship.cruise.factor)
      ship.state.vel.x = -speed
      ship.state.pos.addScaledVector(ship.state.vel, dt)
      const altitude = ship.state.pos.distanceTo(star.pos) - star.radius
      if (altitude <= gravityEdge) break
    }

    const altitude = ship.state.pos.distanceTo(star.pos) - star.radius
    expect(ship.cruise.factor).toBe(1)
    expect(altitude).toBeGreaterThan(gravityEdge)
    expect(altitude - gravityEdge).toBeLessThan(buffer * 2)
  })
})

describe('вне фазы', () => {
  it('разогнанный корабль выходит из фазы', () => {
    const world = emptySystem()
    toDeepSpace(world)
    spool(world, true, 20)
    expect(isPhased(world.player)).toBe(true)
  })

  it('на малом множителе корабль остаётся в фазе', () => {
    const world = emptySystem()
    toDeepSpace(world)
    spool(world, true, 0.2)
    expect(world.player.cruise.factor).toBeLessThan(CRUISE.PHASE_THRESHOLD)
    expect(isPhased(world.player)).toBe(false)
  })
})
