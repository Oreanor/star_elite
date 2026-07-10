import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
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
 * Две а.е. «вверх» от плоскости системы: до звезды и до обеих планет отсюда
 * дальше, чем `MAX_FACTOR · BRAKE_ZONE`, поэтому ни одно тело не режет потолок.
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

describe('торможение у тел', () => {
  it('у самой планеты множитель падает до единицы', () => {
    const world = emptySystem()
    const planet = world.bodies.find((b) => b.kind === 'planet')!
    // На высоте, много меньшей зоны торможения.
    world.player.state.pos.copy(planet.pos).add(new Vector3(0, 0, planet.radius + 200))

    spool(world, true, 10)
    expect(world.player.cruise.factor).toBeLessThan(1.5)
    expect(world.player.cruise.block).toBe('proximity')
  })

  it('множитель растёт с высотой над телом', () => {
    const world = emptySystem()
    const planet = world.bodies.find((b) => b.kind === 'planet')!

    const factorAt = (altitude: number) => {
      const w = emptySystem()
      const p = w.bodies.find((b) => b.kind === 'planet')!
      w.player.state.pos.copy(p.pos).add(new Vector3(0, 0, p.radius + altitude))
      spool(w, true, 25)
      return w.player.cruise.factor
    }

    expect(factorAt(planet.radius * 4)).toBeGreaterThan(factorAt(planet.radius * 0.5))
  })

  /**
   * Регрессия. Зону торможения нельзя задавать как «столько-то радиусов тела»:
   * звезда тормозила бы по всей системе, и до неё нельзя было бы долететь.
   * Потолок задаёт ВЫСОТА над поверхностью, а она уже содержит радиус в себе.
   */
  it('звезда не тормозит игрока с другого конца системы', () => {
    const world = emptySystem()
    const star = world.bodies.find((b) => b.kind === 'star')!
    // Две а.е. от звезды — это далеко даже по меркам звезды.
    world.player.state.pos.copy(star.pos).add(new Vector3(0, 2 * AU, 0))

    spool(world, true, 40)
    expect(world.player.cruise.factor).toBeGreaterThan(CRUISE.MAX_FACTOR * 0.9)
  })

  /**
   * Обратная сторона той же монеты: у причала разогнаться нельзя. Станция мала,
   * но высота над ней ничтожна, а потолок считается от высоты, а не от размера.
   */
  it('у станции крейсер не включается, как бы ни жал игрок', () => {
    const world = emptySystem()
    spool(world, true, 10)

    expect(world.player.cruise.factor).toBe(1)
    expect(world.player.cruise.block).toBe('proximity')
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
