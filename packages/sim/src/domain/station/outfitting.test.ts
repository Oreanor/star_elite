import { describe, expect, it } from 'vitest'
import { AURORA_MK3, SIDEWINDER } from '../../config/chassis'
import {
  BOMB_UNIT,
  CARGO_LARGE,
  CLOAK_FIELD,
  ECM_UNIT,
  SHIELD_HEAVY,
  SHIELD_STANDARD,
} from '../../config/modules'
import { addCommodity, addItem } from '../cargo/hold'
import { COMMODITIES } from '../cargo/items'
import { canInstallInternal, createLoadout, hasBomb, hasEcm } from '../loadout'
import { createWorld } from '../world'
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
 * (SIDEWINDER) класса 2 — на нём это и проверяем.
 */
describe('класс корпуса ограничивает железо', () => {
  it('модуль класса выше корпуса — отказ, свой класс и ниже — встаёт', () => {
    const bare = createLoadout(SIDEWINDER, [], []) // класс корпуса 2
    // SHIELD_STANDARD класса 2 — ровно по корпусу, слот щита есть.
    expect(canInstallInternal(bare, SHIELD_STANDARD)).toBeNull()
    // SHIELD_HEAVY класса 3 — выше класса «Ареса», не по корпусу.
    expect(canInstallInternal(bare, SHIELD_HEAVY)).toBe('class-too-large')
  })

  it('груз бесклассовый — крупный контейнер лезет и в корпус низкого класса', () => {
    const bare = createLoadout(SIDEWINDER, [], [])
    // CARGO_LARGE вместимости 50 т — «класс 1», значит любой корпус его тянет.
    expect(canInstallInternal(bare, CARGO_LARGE)).toBeNull()
  })
})

/**
 * Аукс-слот делят РАЗНЫЕ виды (маскировка/ECM/бомба/…), и занятость считается по всей
 * КАТЕГОРИИ, а не по виду. Иначе примерка ошибётся: бомба «не заметит» клоак и ECM,
 * занявшие обе аукс-ячейки, и решит, что место есть. «Аврора» — два аукс-слота.
 */
describe('аукс-слот: занятость по категории', () => {
  it('заполненный аукс (клоак + ECM) не пускает третье устройство', () => {
    const one = createLoadout(AURORA_MK3, [CLOAK_FIELD], []) // 1 из 2 аукс занят
    expect(canInstallInternal(one, ECM_UNIT)).toBeNull() // второе устройство — влезает
    const full = createLoadout(AURORA_MK3, [CLOAK_FIELD, ECM_UNIT], []) // оба аукс заняты
    // Бомба — иного вида, но той же КАТЕГОРИИ: свободных ячеек нет.
    expect(canInstallInternal(full, BOMB_UNIT)).toBe('no-free-slot')
  })
})

/**
 * Способность гейтится наличием модуля — для всех (принцип «игрок и бот неотличимы»).
 * Голый борт без ECM/бомбы ими не пользуется, хоть контроллер и попросит.
 */
describe('способности требуют аукс-модуль', () => {
  it('без ECM/бомбы — способности нет; с модулем — есть', () => {
    const bare = createLoadout(AURORA_MK3, [], [])
    expect(hasEcm(bare)).toBe(false)
    expect(hasBomb(bare)).toBe(false)
    const armed = createLoadout(AURORA_MK3, [ECM_UNIT, BOMB_UNIT], [])
    expect(hasEcm(armed)).toBe(true)
    expect(hasBomb(armed)).toBe(true)
  })
})
