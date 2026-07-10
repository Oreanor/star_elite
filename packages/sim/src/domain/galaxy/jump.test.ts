import { describe, expect, it } from 'vitest'
import { HYPERDRIVE_DEEP } from '../../config/modules'
import { CORE_INDEX, GALAXY } from '../../config/galaxy'
import { WORLD } from '../../config/world'
import { isHyperdrive } from '../loadout'
import { COMMODITIES, addCommodity } from '../cargo'
import { refreshSpec, createWorld, type World } from '../world'
import { jump, jumpBlock, jumpDistance } from './jump'
import { placeSystem, distanceLy } from './shape'

/**
 * Прыжок — правило, а не кнопка. Всё проверяется без рендера: если для теста
 * понадобился бы браузер, значит логика утекла не в тот слой.
 */

/** Ближайшая к дому система, до которой достаёт базовый привод. */
function neighbourWithin(world: World, range: number): number {
  for (let i = 1; i < GALAXY.COUNT; i++) {
    if (i === world.systemIndex) continue
    if (jumpDistance(world, i) <= range) return i
  }
  throw new Error('у дома нет соседей в пределах прыжка — расстановка звёзд сломана')
}

describe('гиперпривод', () => {
  it('у стартового корабля привод стоит с завода', () => {
    const world = createWorld()
    expect(world.player.spec.jumpRange).toBe(GALAXY.BASE_JUMP_RANGE)
    expect(world.player.loadout.internals.some(isHyperdrive)).toBe(true)
  })

  /** Свойство, а не число: снял привод — заперт в системе, сколько ни жми. */
  it('без привода прыжок невозможен вовсе', () => {
    const world = createWorld()
    const target = neighbourWithin(world, world.player.spec.jumpRange)

    world.player.loadout.internals = world.player.loadout.internals.filter((m) => !isHyperdrive(m))
    refreshSpec(world.player)

    expect(world.player.spec.jumpRange).toBe(0)
    expect(jumpBlock(world, target)).toBe('no-drive')
    expect(jump(world, target)).toBe(false)
  })

  /** Дальность покупается массой: тяжёлый привод режет манёвренность, как тяжёлый щит. */
  it('дальний привод дальше летит и хуже вертится', () => {
    const world = createWorld()
    const pitchBefore = world.player.spec.tuning.PITCH_ACCEL
    const rangeBefore = world.player.spec.jumpRange

    world.player.loadout.internals = [
      ...world.player.loadout.internals.filter((m) => !isHyperdrive(m)),
      HYPERDRIVE_DEEP,
    ]
    refreshSpec(world.player)

    expect(world.player.spec.jumpRange).toBeGreaterThan(rangeBefore)
    expect(world.player.spec.tuning.PITCH_ACCEL).toBeLessThan(pitchBefore)
  })
})

describe('прыжок', () => {
  it('дальше дальности привода не прыгнуть, и причина названа', () => {
    const world = createWorld()
    const range = world.player.spec.jumpRange

    // Ядро галактики в сотне световых лет от дома — заведомо дальше базового привода.
    expect(jumpDistance(world, CORE_INDEX)).toBeGreaterThan(range)
    expect(jumpBlock(world, CORE_INDEX)).toBe('out-of-range')
    expect(jump(world, CORE_INDEX)).toBe(false)
    expect(world.systemIndex).toBe(WORLD.HOME_INDEX)
  })

  it('в себя не прыгают, и из дока тоже', () => {
    const world = createWorld()
    expect(jumpBlock(world, world.systemIndex)).toBe('same-system')

    const target = neighbourWithin(world, world.player.spec.jumpRange)
    world.docked = true
    expect(jumpBlock(world, target)).toBe('docked')
  })

  it('прыжок в пределах дальности меняет систему', () => {
    const world = createWorld()
    const target = neighbourWithin(world, world.player.spec.jumpRange)

    expect(jump(world, target)).toBe(true)
    expect(world.systemIndex).toBe(target)
    expect(world.epoch).toBe(1)
    expect(world.systemName).not.toBe('Тиррион')
    // Звезда обязана быть: система без светила — это дыра в мосте.
    expect(world.bodies.some((b) => b.kind === 'star')).toBe(true)
  })

  /**
   * Прыгает ПИЛОТ, а не вселенная. Корабль, кредиты, трюм и очки переживают
   * смену системы; чужой бой — трассы, ракеты, обломки — остаётся позади.
   */
  it('корабль и кошелёк переживают прыжок, а чужой бой — нет', () => {
    const world = createWorld()
    const target = neighbourWithin(world, world.player.spec.jumpRange)

    world.credits = 4242
    world.score = 7
    addCommodity(world.player.hold, COMMODITIES.SCRAP, 1)
    refreshSpec(world.player)
    const cargo = world.player.hold.items.length

    world.player.hull = 33
    world.missiles.push({} as never)
    world.tracers.push({} as never)

    expect(jump(world, target)).toBe(true)
    expect(world.credits).toBe(4242)
    expect(world.score).toBe(7)
    expect(world.player.hull).toBe(33)
    expect(world.player.hold.items.length).toBe(cargo)
    expect(world.missiles).toHaveLength(0)
    expect(world.tracers).toHaveLength(0)
  })

  /** Одно зерно — одна галактика. Прыжок туда-обратно приводит в ту же систему. */
  it('система детерминирована: вернулся — застал ту же', () => {
    const a = createWorld()
    const b = createWorld()
    const target = neighbourWithin(a, a.player.spec.jumpRange)

    jump(a, target)
    jump(b, target)
    expect(a.systemName).toBe(b.systemName)
    expect(a.bodies.map((x) => x.name)).toEqual(b.bodies.map((x) => x.name))
  })

  /** Дом задан вручную, но в галактике у него есть место — и прыгнуть домой можно. */
  it('домой возвращаются в ту же рукописную систему', () => {
    const world = createWorld()
    const target = neighbourWithin(world, world.player.spec.jumpRange)

    jump(world, target)
    expect(jump(world, WORLD.HOME_INDEX)).toBe(true)
    expect(world.systemName).toBe('Тиррион')
  })

  it('расстояние симметрично и считается по трём осям', () => {
    const world = createWorld()
    const a = placeSystem(WORLD.HOME_INDEX)
    const b = placeSystem(7)
    expect(jumpDistance(world, 7)).toBeCloseTo(distanceLy(a, b))
    expect(distanceLy(a, b)).toBeCloseTo(distanceLy(b, a))
  })
})
