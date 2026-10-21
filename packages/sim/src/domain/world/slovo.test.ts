import { describe, expect, it } from 'vitest'
import { createWorld, enterSystem, spawnSlovo, stepSlovoRota } from './factory'
import { rememberPilot } from './acquaintance'
import { spawnResidentContacts } from './traffic'
import { SLOVO_KIND, SLOVO_NAME, slovoAtHome } from './slovo'
import { TIME } from '../../config/time'
import { mayHailPlayer } from './acquaintance'
import type { World } from './entities'
import { STARTER_SYSTEM } from './system'
import type { SystemDef } from './system'
import type { ShipEntity } from './entities'

/**
 * Слово — особый бог на Кресте. Проверяем не числа, а ИНВАРИАНТЫ его существования:
 * он всегда сидит на Кресте ровно в одном экземпляре, не летает и не считается физикой,
 * его нельзя размножить, а знакомство с ним не воскрешается случайным бортом из трафика.
 */

/** Минимальная система с Крестом — как Люцифер, но без лишнего. */
const CROSS_SYS: SystemDef = {
  name: 'Люцифер',
  seed: 1,
  playerStart: [0, 0, 1_000],
  star: { pos: [0, 0, 0], radius: 1e9, color: 0xffffff, massSolar: 1 },
  companion: null,
  dyson: null,
  planets: [],
  station: { name: 'Причал «Веер»', pos: [0, 0, -16_000], radius: 4_000, style: 'solar' },
  extraStations: [{ name: 'Крест «Вечность»', pos: [0, 0, -40_000], radius: 6_000, style: 'cross' }],
  belt: null,
  patrols: [],
  desolate: true,
}

/** Игровые сутки в единицах calendarTime. */
const DAY = 86_400 / TIME.SCALE

/** Первый момент от `from`, когда бог дома (или в отлучке) — шагом в сутки. */
function momentWhen(seed: number, home: boolean, from = 0): number {
  for (let t = from; t < from + 400 * DAY; t += DAY) if (slovoAtHome(seed, t) === home) return t
  throw new Error('расписание застряло')
}

/** Система с Крестом в момент, когда бог ДОМА: проверяем то, что от расписания не зависит. */
function crossWorld(): World {
  const probe = createWorld(CROSS_SYS)
  const world = createWorld(CROSS_SYS)
  world.ships = world.ships.filter((s) => !s.divine)
  world.calendarTime = momentWhen(probe.galaxySeed, true)
  spawnSlovo(world)
  return world
}

/** Боги среди бортов. Тип держим `ShipEntity`: иначе фильтр сужал бы его до `{divine?}`,
 *  и до полей борта (имя, ИИ, поза) было бы не добраться. */
const divineShips = (ships: readonly ShipEntity[]): ShipEntity[] => ships.filter((s) => s.divine)

describe('Слово (бог на Крестах)', () => {
  it('сидит ТОЛЬКО на Кресте, кинематический и без ИИ', () => {
    const world = crossWorld()
    const gods = divineShips(world.ships)
    const stations = world.bodies.filter((b) => b.kind === 'station')
    const crosses = stations.filter((b) => b.stationStyle === 'cross')
    // В системе два причала — обычный «Веер» и Крест, — а бог один, и он на Кресте.
    expect(stations.length).toBeGreaterThan(1)
    expect(gods).toHaveLength(crosses.length)

    for (const slovo of gods) {
      expect(slovo.name).toBe(SLOVO_NAME)
      expect(slovo.originKind).toBe(SLOVO_KIND)
      expect(slovo.ai).toBeNull() // не думает и не рулит
      expect(slovo.kinematic).toBe(true) // не летает, вне физики/рендера/столкновений
      expect(slovo.clearance).toBe(true) // под защитой станции
      // Сидит ИМЕННО в Кресте, а не рядом и не у соседнего причала.
      const nearest = Math.min(...crosses.map((s) => slovo.state.pos.distanceTo(s.pos)))
      expect(nearest).toBeLessThan(1)
    }
  })

  it('в системе БЕЗ станций бога нет — ему негде сидеть', () => {
    const world = createWorld({ ...CROSS_SYS, station: null, extraStations: [] })
    expect(divineShips(world.ships)).toHaveLength(0)
  })

  it('в обычной системе с простым причалом бога НЕТ — он не вахтёр', () => {
    const world = createWorld(STARTER_SYSTEM)
    expect(world.bodies.some((b) => b.kind === 'station')).toBe(true)
    expect(divineShips(world.ships)).toHaveLength(0)
  })

  it('повторный спавн не плодит двойников', () => {
    const world = crossWorld()
    const crosses = world.bodies.filter((b) => b.kind === 'station' && b.stationStyle === 'cross').length
    spawnSlovo(world)
    spawnSlovo(world)
    // Идемпотентность ПО КРЕСТУ: сколько монументов — столько богов, сколько ни зови.
    expect(divineShips(world.ships)).toHaveLength(crosses)
  })

  it('знакомство создаёт ОДНУ запись-бога: он вездесущ, но существо одно', () => {
    const world = crossWorld()
    const slovo = divineShips(world.ships)[0]!

    rememberPilot(world, slovo)
    const record = world.acquaintances.find((a) => a.kindId === SLOVO_KIND)
    expect(record).toBeDefined()
    expect(slovo.acquaintanceId).toBe(record!.id)

    // Прыжок прочь и обратно: боги рождаются заново, но ВСЕ цепляются к ТОЙ ЖЕ записи —
    // журнал и отношение у него общие, сколько бы причалов он ни занимал.
    enterSystem(world, STARTER_SYSTEM, 0)
    for (const g of divineShips(world.ships)) expect(g.acquaintanceId).toBe(record!.id)

    enterSystem(world, CROSS_SYS, 1)
    const gods = divineShips(world.ships)
    expect(gods.length).toBeGreaterThan(0)
    for (const g of gods) expect(g.acquaintanceId).toBe(record!.id)
    expect(world.acquaintances.filter((a) => a.kindId === SLOVO_KIND)).toHaveLength(1)
  })

  /**
   * ПОРЯДОК ЗАГРУЗКИ. Бог садится внутри `enterSystem`, а журнал знакомств приезжает из сейва
   * ПОЗЖЕ — в момент посадки список пуст, и борт остаётся без `acquaintanceId`. Оттого «разозлил
   * бога, перезашёл — а он снова нейтрален»: гнев жил в записи, но бог к ней не был привязан.
   * Повторный вызов `spawnSlovo` (его и делает вход в игру) обязан починить связь задним числом.
   */
  it('перецепляется к записи, если журнал приехал ПОСЛЕ его посадки', () => {
    const world = crossWorld()
    const slovo = divineShips(world.ships)[0]!
    rememberPilot(world, slovo)
    const record = world.acquaintances.find((a) => a.kindId === SLOVO_KIND)!

    // Имитируем вход в игру: боги уже сидят, а связь с записью ещё не установлена.
    for (const g of divineShips(world.ships)) g.acquaintanceId = null

    spawnSlovo(world)

    // Все боги снова смотрят в ТУ ЖЕ запись — отношение и журнал при них.
    const gods = divineShips(world.ships)
    expect(gods.length).toBeGreaterThan(0)
    for (const g of gods) expect(g.acquaintanceId).toBe(record.id)
    // И двойников не наплодили.
    expect(gods).toHaveLength(world.bodies.filter((b) => b.kind === 'station' && b.stationStyle === 'cross').length)
  })

  it('трафик резидентов не воскрешает бога случайным бортом', () => {
    const world = crossWorld()
    const slovo = divineShips(world.ships)[0]!
    rememberPilot(world, slovo)

    // Убираем живого бога и зовём заселение резидентов: запись-бог осталась, но нового
    // борта под именем Слова из ENCOUNTERS появиться НЕ должно.
    world.ships = world.ships.filter((s) => !s.divine)
    const born = spawnResidentContacts(world)
    expect(born.some((s) => s.name === SLOVO_NAME || s.originKind === SLOVO_KIND)).toBe(false)
  })

  it('«то есть, то нет»: дома примерно половину времени, пластами от недели до месяца', () => {
    const seed = createWorld(CROSS_SYS).galaxySeed
    let home = 0
    let runs = 0
    let runLen = 0
    let shortest = Infinity
    let prev = slovoAtHome(seed, 0)
    const days = 3000
    for (let d = 0; d < days; d++) {
      const now = slovoAtHome(seed, d * DAY + DAY / 2)
      if (now) home++
      if (now === prev) runLen++
      else {
        if (runs > 0) shortest = Math.min(shortest, runLen)
        runs++
        runLen = 1
        prev = now
      }
    }
    expect(home / days).toBeGreaterThan(0.4)
    expect(home / days).toBeLessThan(0.6)
    // Пласт не короче недели: бог не мигает туда-сюда через день.
    expect(shortest).toBeGreaterThanOrEqual(7)
  })

  it('приходит и уходит по календарю при тебе, но не посреди стоянки у причала', () => {
    const world = crossWorld()
    expect(divineShips(world.ships).length).toBeGreaterThan(0)

    world.calendarTime = momentWhen(world.galaxySeed, false, world.calendarTime)
    world.docked = true
    stepSlovoRota(world)
    expect(divineShips(world.ships).length).toBeGreaterThan(0) // пристыкован — не уходит

    world.docked = false
    stepSlovoRota(world)
    expect(divineShips(world.ships)).toHaveLength(0)

    world.calendarTime = momentWhen(world.galaxySeed, true, world.calendarTime)
    stepSlovoRota(world)
    expect(divineShips(world.ships).length).toBeGreaterThan(0)
  })

  it('незнакомый бог сам не окликает; знакомый — как все', () => {
    const world = crossWorld()
    const slovo = divineShips(world.ships)[0]!
    expect(mayHailPlayer(slovo)).toBe(false)
    rememberPilot(world, slovo)
    expect(mayHailPlayer(slovo)).toBe(true)
  })
})

