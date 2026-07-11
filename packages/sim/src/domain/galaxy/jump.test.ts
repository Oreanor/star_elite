import { describe, expect, it } from 'vitest'
import { HYPERDRIVE_DEEP } from '../../config/modules'
import { CORE_INDEX, GALAXY } from '../../config/galaxy'
import { WORLD } from '../../config/world'
import { isHyperdrive } from '../loadout'
import { COMMODITIES, addCommodity } from '../cargo'
import { refreshSpec, createWorld, type World } from '../world'
import { generateGalaxy, generateSystem } from './generate'
import { jump, jumpBlock, jumpDistance, systemDefFor } from './jump'
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

  /**
   * На крейсерском ходу прыжок заперт: сначала сбрось скорость. Иначе привод бьёт
   * из разгона в семьдесят тысяч км за шаг — кино прыжка не за что зацепить.
   */
  it('на крейсерском ходу не прыгнуть, пока не сбросишь ход', () => {
    const world = createWorld()
    const target = neighbourWithin(world, world.player.spec.jumpRange)

    world.player.cruise.factor = 20
    expect(jumpBlock(world, target)).toBe('cruising')
    expect(jump(world, target)).toBe(false)

    world.player.cruise.factor = 1
    expect(jumpBlock(world, target)).toBeNull()
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
    // Первый прыжок сжёг заряд; здесь проверяется адресация дома, а не топливо —
    // доливаем бак, как это сделала бы звезда или причал.
    world.player.jumpCharge = world.player.spec.jumpRange
    expect(jump(world, WORLD.HOME_INDEX)).toBe(true)
    expect(world.systemName).toBe('Тиррион')
  })

  /**
   * Карта читает каталог (`generateSystem`), сцена строит мир из `SystemDef`.
   * Это два описания ОДНОЙ звезды, и разойтись им нельзя: пока они расходились,
   * карта звала родную систему «Альовас», а причал под ногами — «Тиррион».
   */
  it('каталог и сцена описывают родную систему одинаково', () => {
    const catalogue = generateSystem(WORLD.HOME_INDEX, GALAXY.SEED)
    const def = systemDefFor(WORLD.HOME_INDEX, GALAXY.SEED)

    expect(catalogue.name).toBe(def.name)
    expect(catalogue.planets.length).toBe(def.planets.length)
    expect(catalogue.planets.map((p) => p.name)).toEqual(def.planets.map((p) => p.name))
    expect(catalogue.planets.map((p) => p.type)).toEqual(def.planets.map((p) => p.type))

    const capital = catalogue.planets.find((p) => p.station)
    expect(capital?.station?.name).toBe(def.station?.name)
    expect(catalogue.star.color).toBe(def.star.color)
  })

  /** Тиррион существует в одном экземпляре: чужая галактика о нём не знает. */
  it('в другой галактике под тем же индексом стоит обычная звезда', () => {
    const alien = generateSystem(WORLD.HOME_INDEX, GALAXY.SEED ^ 0x1234)
    expect(alien.name).not.toBe('Тиррион')
  })

  /** Имя, данное руками, не отбирает разведение коллизий: оно занято до бросков. */
  it('в галактике ровно одна система с родным именем', () => {
    const named = generateGalaxy(GALAXY.SEED).filter((s) => s.name === 'Тиррион')
    expect(named.map((s) => s.index)).toEqual([WORLD.HOME_INDEX])
  })

  /**
   * Ядро — не система, а ворота. Прыжок в него меняет ЗЕРНО галактики (а с ним и
   * все 2500 систем разом), и корабль выходит у чёрной дыры уже НОВОЙ галактики.
   * Проверяем переход, а не топливо, поэтому доливаем бак и ставим дальний привод.
   */
  it('прыжок в ядро уводит в другую галактику через чёрную дыру', () => {
    const world = createWorld()
    world.player.spec.jumpRange = 1e6
    world.player.jumpCharge = 1e6
    const seedBefore = world.galaxySeed

    expect(jump(world, CORE_INDEX)).toBe(true)
    expect(world.galaxySeed).not.toBe(seedBefore) // галактика сменилась целиком
    expect(world.systemIndex).toBe(CORE_INDEX) // вышли у чёрной дыры новой галактики
    // В новой галактике под индексом дома стоит уже не рукописный Тиррион.
    expect(systemDefFor(WORLD.HOME_INDEX, world.galaxySeed).name).not.toBe('Тиррион')
  })

  /** Цепочка галактик детерминирована: тот же старт — то же следующее зерно. */
  it('следующая галактика за дырой одна и та же при том же старте', () => {
    const mk = () => {
      const w = createWorld()
      w.player.spec.jumpRange = 1e6
      w.player.jumpCharge = 1e6
      return w
    }
    const a = mk()
    const b = mk()
    jump(a, CORE_INDEX)
    jump(b, CORE_INDEX)
    expect(a.galaxySeed).toBe(b.galaxySeed)
  })

  it('расстояние симметрично и считается по трём осям', () => {
    const world = createWorld()
    const a = placeSystem(WORLD.HOME_INDEX)
    const b = placeSystem(7)
    expect(jumpDistance(world, 7)).toBeCloseTo(distanceLy(a, b))
    expect(distanceLy(a, b)).toBeCloseTo(distanceLy(b, a))
  })
})
