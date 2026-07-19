import { describe, expect, it } from 'vitest'
import { createWorld, enterSystem, spawnSlovo } from './factory'
import { rememberPilot } from './acquaintance'
import { spawnResidentContacts } from './traffic'
import { SLOVO_KIND, SLOVO_NAME } from './slovo'
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

/** Боги среди бортов. Тип держим `ShipEntity`: иначе фильтр сужал бы его до `{divine?}`,
 *  и до полей борта (имя, ИИ, поза) было бы не добраться. */
const divineShips = (ships: readonly ShipEntity[]): ShipEntity[] => ships.filter((s) => s.divine)

describe('Слово (бог у причалов)', () => {
  it('сидит у КАЖДОЙ станции, кинематический и без ИИ', () => {
    const world = createWorld(CROSS_SYS)
    const gods = divineShips(world.ships)
    const stations = world.bodies.filter((b) => b.kind === 'station')
    // Вездесущ: по одному у каждого причала (в этой системе — «Веер» и Крест).
    expect(stations.length).toBeGreaterThan(1)
    expect(gods).toHaveLength(stations.length)

    for (const slovo of gods) {
      expect(slovo.name).toBe(SLOVO_NAME)
      expect(slovo.originKind).toBe(SLOVO_KIND)
      expect(slovo.ai).toBeNull() // не думает и не рулит
      expect(slovo.kinematic).toBe(true) // не летает, вне физики/рендера/столкновений
      expect(slovo.clearance).toBe(true) // под защитой станции
      // Каждый сидит ИМЕННО в станции, а не рядом.
      const nearest = Math.min(...stations.map((s) => slovo.state.pos.distanceTo(s.pos)))
      expect(nearest).toBeLessThan(1)
    }
    // И ни один причал не остался без него.
    for (const station of stations) {
      expect(gods.some((g) => g.state.pos.distanceTo(station.pos) < 1)).toBe(true)
    }
  })

  it('в системе БЕЗ станций бога нет — ему негде сидеть', () => {
    const world = createWorld({ ...CROSS_SYS, station: null, extraStations: [] })
    expect(divineShips(world.ships)).toHaveLength(0)
  })

  it('в обычной системе он тоже есть — у её причала', () => {
    const world = createWorld(STARTER_SYSTEM)
    const stations = world.bodies.filter((b) => b.kind === 'station')
    expect(divineShips(world.ships)).toHaveLength(stations.length)
  })

  it('повторный спавн не плодит двойников у тех же причалов', () => {
    const world = createWorld(CROSS_SYS)
    const stations = world.bodies.filter((b) => b.kind === 'station').length
    spawnSlovo(world)
    spawnSlovo(world)
    // Идемпотентность ПО СТАНЦИИ: сколько причалов — столько богов, сколько ни зови.
    expect(divineShips(world.ships)).toHaveLength(stations)
  })

  it('знакомство создаёт ОДНУ запись-бога: он вездесущ, но существо одно', () => {
    const world = createWorld(CROSS_SYS)
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
    const world = createWorld(CROSS_SYS)
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
    expect(gods).toHaveLength(world.bodies.filter((b) => b.kind === 'station').length)
  })

  it('трафик резидентов не воскрешает бога случайным бортом', () => {
    const world = createWorld(CROSS_SYS)
    const slovo = divineShips(world.ships)[0]!
    rememberPilot(world, slovo)

    // Убираем живого бога и зовём заселение резидентов: запись-бог осталась, но нового
    // борта под именем Слова из ENCOUNTERS появиться НЕ должно.
    world.ships = world.ships.filter((s) => !s.divine)
    const born = spawnResidentContacts(world)
    expect(born.some((s) => s.name === SLOVO_NAME || s.originKind === SLOVO_KIND)).toBe(false)
  })
})
