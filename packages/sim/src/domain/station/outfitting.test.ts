import { describe, expect, it } from 'vitest'
import { refreshSpec } from '../world/factory'
import { veteranWorld } from '../../testkit'
import { AURORA_ONE, HERMES } from '../../config/chassis'
import {
  BOMB_UNIT,
  CARGO_LARGE,
  CLOAK_FIELD,
  ECM_UNIT,
  MODULE_CATALOGUE,
  SHIELD_HEAVY,
  SHIELD_STANDARD,
  SHRINK_RAY,
  HOLD_RAY,
  PULSE_LASER,
} from '../../config/modules'
import { addCommodity, addItem } from '../cargo/hold'
import { COMMODITIES } from '../cargo/items'
import { createLoadout, hasBomb, hasEcm, type Loadout } from '../loadout'
import { STARTER_SYSTEM } from '../world'
import { canBuy, fitDeltas, fitFromHold, stationStock } from './shop'
import { withUpgrade } from './moduleState'

/**
 * Перестановка железа из трюма. Проверяем СВОЙСТВА: установка меняет корабль,
 * снятое не пропадает, а сравнение сразу говорит, плюс это или минус.
 */

describe('перестановка железа из трюма', () => {
  it('установка из трюма усиливает щит, а снятое уходит обратно в трюм', () => {
    const world = veteranWorld()
    const player = world.player
    const before = player.spec.hull.shield // стартовый SHIELD_STANDARD
    addItem(player.hold, { kind: 'module', module: SHIELD_HEAVY })

    expect(fitFromHold(player, player.hold.items.length - 1)).toBeNull()
    expect(player.spec.hull.shield).toBe(SHIELD_HEAVY.capacity)
    expect(player.spec.hull.shield).toBeGreaterThan(before)
    // Снятый штатный щит теперь в трюме — его не выбросили, а вернули владельцу.
    expect(player.hold.items.some((i) => i.kind === 'module' && i.module.id === SHIELD_STANDARD.id)).toBe(true)
    // Тяжёлый из трюма исчез — он на корабле.
    expect(player.hold.items.some((i) => i.kind === 'module' && i.module.id === SHIELD_HEAVY.id)).toBe(false)
  })

  it('сравнение сразу показывает плюс: тяжёлый щит поднимает защиту', () => {
    const world = veteranWorld()
    const shield = fitDeltas(world.player, SHIELD_HEAVY).find((d) => d.key === 'shield')
    expect(shield).toBeDefined()
    expect(shield!.to).toBeGreaterThan(shield!.from)
    expect(shield!.higherBetter).toBe(true)
  })

  it('сравнение — моделей, а не экземпляров: свой прокачанный щит не затмевает тяжёлый', () => {
    // Пойманное: прокачанный штатный щит выглядел лучше любого дорогого базового, и витрина
    // красила старший класс в «хуже». Сравниваются заводские версии обеих сторон.
    const world = veteranWorld()
    const p = world.player
    const i = p.loadout.internals.findIndex((m) => m.id === SHIELD_STANDARD.id)
    expect(i).toBeGreaterThanOrEqual(0)
    p.loadout.internals[i] = withUpgrade(SHIELD_STANDARD, 2)
    refreshSpec(p)
    expect(p.spec.hull.shield).toBeGreaterThan(SHIELD_HEAVY.capacity)

    const shield = fitDeltas(p, SHIELD_HEAVY).find((d) => d.key === 'shield')!
    expect(shield.from).toBe(SHIELD_STANDARD.capacity)
    expect(shield.to).toBeGreaterThan(shield.from)
  })

  it('сравнение всего каталога не падает, если слота под модуль нет', () => {
    // Витрина спрашивает «было → станет» у каждой строки сразу. Пустой слот
    // (класс не пускает, категории нет) не должен ронять reduce по пустому списку.
    const world = veteranWorld()
    for (const module of MODULE_CATALOGUE) {
      expect(() => fitDeltas(world.player, module)).not.toThrow()
    }
  })

  it('тот же модуль, что уже стоит, ставить незачем — отказ', () => {
    const world = veteranWorld()
    addItem(world.player.hold, { kind: 'module', module: SHIELD_STANDARD })
    expect(fitFromHold(world.player, world.player.hold.items.length - 1)).toBe('already-installed')
  })

  it('обычный груз, а не модуль, на корабль не поставить', () => {
    const world = veteranWorld()
    addCommodity(world.player.hold, COMMODITIES.FOOD, 1)
    expect(fitFromHold(world.player, world.player.hold.items.length - 1)).toBe('not-a-module')
  })
})

/**
 * Класс гейтит КОРПУС, а не отдельный слот: железо выше класса рамы не встаёт,
 * какой бы слот под него ни был. Груз — бесклассовый и лезет всегда. «Ника»
 * класса 2 — на ней это и проверяем: дорогие рамы класс 3 уже принимают.
 */
/** Борт с этой сборкой и деньгами на что угодно — проверяем правило верфи (`canBuy`). */
function shipWith(loadout: Loadout) {
  const world = veteranWorld()
  world.credits = 1e9
  world.player.loadout = loadout
  refreshSpec(world.player)
  return world
}

describe('класс корпуса ограничивает железо', () => {
  it('модуль класса выше корпуса — отказ, свой класс и ниже — встаёт', () => {
    const world = shipWith(createLoadout(AURORA_ONE, [], []))
    // SHIELD_STANDARD класса 2 — ровно по корпусу, слот щита есть.
    expect(canBuy(world, world.player, SHIELD_STANDARD)).toBeNull()
    // SHIELD_HEAVY класса 3 — выше «Ники», не по корпусу.
    expect(canBuy(world, world.player, SHIELD_HEAVY)).toBe('class-too-large')
  })

  it('груз бесклассовый — крупный контейнер лезет и в корпус низкого класса', () => {
    const world = shipWith(createLoadout(HERMES, [], []))
    // CARGO_LARGE вместимости 50 т — «класс 1», значит любой корпус его тянет.
    expect(canBuy(world, world.player, CARGO_LARGE)).toBeNull()
  })
})

/**
 * Аукс-слот делят РАЗНЫЕ виды (маскировка/ECM/бомба/…), и занятость считается по всей
 * КАТЕГОРИИ, а не по виду. У любого корпуса — один аукс-слот: новое устройство встаёт
 * ЗАМЕНОЙ занявшего его (верфь меняет, а не отказывает), второе рядом не появится.
 */
describe('аукс-слот: занятость по категории', () => {
  it('занятый аукс принимает другое устройство заменой, а не вторым рядом', () => {
    // Рама с аукс-слотом класса 3 — маскировка третьего класса (у стартовой «Ники» аукс 2-го).
    const world = shipWith(createLoadout(HERMES, [CLOAK_FIELD], []))
    expect(canBuy(world, world.player, ECM_UNIT)).toBeNull()
    expect(canBuy(world, world.player, BOMB_UNIT)).toBeNull()
    // Та же маскировка ещё раз — ничего не добавит: верфь её не продаст.
    expect(canBuy(world, world.player, CLOAK_FIELD)).toBe('already-installed')
  })
})

/**
 * Способность гейтится наличием модуля — для всех (принцип «игрок и бот неотличимы»).
 * Голый борт без ECM/бомбы ими не пользуется, хоть контроллер и попросит.
 */
describe('способности требуют аукс-модуль', () => {
  it('без ECM/бомбы — способности нет; с модулем — есть', () => {
    const bare = createLoadout(AURORA_ONE, [], [])
    expect(hasEcm(bare)).toBe(false)
    expect(hasBomb(bare)).toBe(false)
    const armed = createLoadout(AURORA_ONE, [ECM_UNIT, BOMB_UNIT], [])
    expect(hasEcm(armed)).toBe(true)
    expect(hasBomb(armed)).toBe(true)
  })
})

describe('перестановка своего железа', () => {
  it('лазер из трюма встаёт в ВЫБРАННУЮ точку подвески, снятый — в трюм', () => {
    // Пойманное: установка из трюма брала первую подходящую точку, а не ту, что кликнул
    // игрок, — менять лазеры в полёте поштучно было нельзя.
    const world = veteranWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    const p = world.player
    const guns = p.loadout.chassis.hardpoints.map((h, i) => ({ h, i })).filter(({ h }) => h.kind === 'gun')
    if (guns.length < 2) return
    const target = guns[guns.length - 1]!.i
    const before = p.loadout.weapons[target]
    addItem(p.hold, { kind: 'module', module: SHRINK_RAY, costBasis: 0 })
    expect(fitFromHold(p, p.hold.items.length - 1, target)).toBeNull()
    expect(p.loadout.weapons[target]?.id).toBe(SHRINK_RAY.id)
    if (before) expect(p.hold.items.some((i) => i.kind === 'module' && i.module.id === before.id)).toBe(true)
  })
})

describe('грузоподъёмность', () => {
  it('итог трюма — корпус + контейнеры − масса обвеса, а не сумма контейнеров', () => {
    // Пойманное: «отсеки 19 и 4, а в трюме 17» — итог честный, но без раскладки читался ошибкой.
    const world = veteranWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    const { cargoBudget: b, cargoCapacity } = world.player.spec
    expect(cargoCapacity).toBe(Math.max(0, Math.floor(b.chassis + b.racks - b.equipment)))
    expect(b.equipment).toBeGreaterThan(0)
  })
})

describe('сравнение оружия в слоте', () => {
  it('«лучше/хуже» — против того, что стоит в ОТКРЫТОЙ точке, а не в соседней', () => {
    // Пойманное: открыл слот удерживающего луча (урон 0) — весь трюм со стрелкой «хуже»:
    // сравнение шло с точкой автоустановки, где стоял лазер на 30.
    const world = veteranWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    const p = world.player
    const guns = p.loadout.chassis.hardpoints.map((h, i) => ({ h, i })).filter(({ h }) => h.kind === 'gun')
    if (guns.length < 2) return
    const slot = guns[guns.length - 1]!.i
    p.loadout.weapons[slot] = HOLD_RAY
    const d = fitDeltas(p, PULSE_LASER, slot).find((x) => x.key === 'damage')!
    expect(d.from).toBe(0)
    expect(d.to).toBeGreaterThan(d.from)
  })
})

describe('витрина станции', () => {
  it('каждого вида оборудования — не больше 2–4 моделей, а не всё подряд', () => {
    // Пойманное: у столицы было по 5–7 двигателей и щитов — выбирать не из чего интересного.
    const world = veteranWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    const counts = new Map<string, number>()
    for (const m of stationStock(world)) {
      const g = m.kind === 'drone' ? 'missile' : m.kind
      counts.set(g, (counts.get(g) ?? 0) + 1)
    }
    expect(counts.size).toBeGreaterThan(0)
    for (const [kind, n] of counts) expect(n, kind).toBeLessThanOrEqual(4)
  })
})

describe('сравнение «было → станет» с усиленной рамой', () => {
  it('доп. оборудование не «срезает» корпус на купленное усиление рамы', () => {
    // Пойманное: «после» считалось на голой раме — у «Гермеса» с усилением любой модуль
    // в пустом аукс-слоте показывал «КОРПУС 1288 → 1183 ▼».
    const world = veteranWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    const p = world.player
    p.hullUp = { ...p.hullUp, hull: true }
    refreshSpec(p)
    const hull = fitDeltas(p, ECM_UNIT).find((d) => d.key === 'hull')
    expect(hull).toBeUndefined()
  })
})
