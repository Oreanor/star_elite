import { describe, expect, it } from 'vitest'
import { AURORA_ONE, HERMES } from '../../config/chassis'
import {
  BOMB_UNIT,
  CARGO_LARGE,
  CLOAK_FIELD,
  ECM_UNIT,
  SHIELD_HEAVY,
  SHIELD_STANDARD,
  SHRINK_RAY,
  HOLD_RAY,
  PULSE_LASER,
} from '../../config/modules'
import { addCommodity, addItem } from '../cargo/hold'
import { COMMODITIES } from '../cargo/items'
import { canInstallInternal, createLoadout, hasBomb, hasEcm } from '../loadout'
import { createWorld, STARTER_SYSTEM } from '../world'
import { fitDeltas, fitFromHold } from './shop'

/**
 * Перестановка железа из трюма. Проверяем СВОЙСТВА: установка меняет корабль,
 * снятое не пропадает, а сравнение сразу говорит, плюс это или минус.
 */

describe('перестановка железа из трюма', () => {
  it('установка из трюма усиливает щит, а снятое уходит обратно в трюм', () => {
    const world = createWorld()
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
    const world = createWorld()
    const shield = fitDeltas(world.player, SHIELD_HEAVY).find((d) => d.key === 'shield')
    expect(shield).toBeDefined()
    expect(shield!.to).toBeGreaterThan(shield!.from)
    expect(shield!.higherBetter).toBe(true)
  })

  it('тот же модуль, что уже стоит, ставить незачем — отказ', () => {
    const world = createWorld()
    addItem(world.player.hold, { kind: 'module', module: SHIELD_STANDARD })
    expect(fitFromHold(world.player, world.player.hold.items.length - 1)).toBe('already-installed')
  })

  it('обычный груз, а не модуль, на корабль не поставить', () => {
    const world = createWorld()
    addCommodity(world.player.hold, COMMODITIES.FOOD, 1)
    expect(fitFromHold(world.player, world.player.hold.items.length - 1)).toBe('not-a-module')
  })
})

/**
 * Класс гейтит КОРПУС, а не отдельный слот: железо выше класса рамы не встаёт,
 * какой бы слот под него ни был. Груз — бесклассовый и лезет всегда. «Арес»
 * (HERMES) класса 2 — на нём это и проверяем.
 */
describe('класс корпуса ограничивает железо', () => {
  it('модуль класса выше корпуса — отказ, свой класс и ниже — встаёт', () => {
    const bare = createLoadout(HERMES, [], []) // класс корпуса 2
    // SHIELD_STANDARD класса 2 — ровно по корпусу, слот щита есть.
    expect(canInstallInternal(bare, SHIELD_STANDARD)).toBeNull()
    // SHIELD_HEAVY класса 3 — выше класса «Ареса», не по корпусу.
    expect(canInstallInternal(bare, SHIELD_HEAVY)).toBe('class-too-large')
  })

  it('груз бесклассовый — крупный контейнер лезет и в корпус низкого класса', () => {
    const bare = createLoadout(HERMES, [], [])
    // CARGO_LARGE вместимости 50 т — «класс 1», значит любой корпус его тянет.
    expect(canInstallInternal(bare, CARGO_LARGE)).toBeNull()
  })
})

/**
 * Аукс-слот делят РАЗНЫЕ виды (маскировка/ECM/бомба/…), и занятость считается по всей
 * КАТЕГОРИИ, а не по виду. Иначе примерка ошибётся: бомба «не заметит» клоак,
 * занявшую аукс-ячейку, и решит, что место есть. У любого корпуса — один аукс-слот.
 */
describe('аукс-слот: занятость по категории', () => {
  it('занятый аукс не пускает второе устройство той же категории', () => {
    const one = createLoadout(AURORA_ONE, [CLOAK_FIELD], [])
    expect(canInstallInternal(one, ECM_UNIT)).toBe('no-free-slot')
    expect(canInstallInternal(one, BOMB_UNIT)).toBe('no-free-slot')
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
    const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
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
    const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    const { cargoBudget: b, cargoCapacity } = world.player.spec
    expect(cargoCapacity).toBe(Math.max(0, Math.floor(b.chassis + b.racks - b.equipment)))
    expect(b.equipment).toBeGreaterThan(0)
  })
})

describe('сравнение оружия в слоте', () => {
  it('«лучше/хуже» — против того, что стоит в ОТКРЫТОЙ точке, а не в соседней', () => {
    // Пойманное: открыл слот удерживающего луча (урон 0) — весь трюм со стрелкой «хуже»:
    // сравнение шло с точкой автоустановки, где стоял лазер на 30.
    const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
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
