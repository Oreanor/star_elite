import { describe, expect, it } from 'vitest'
import { SHIELD_HEAVY, SHIELD_STANDARD } from '../../config/modules'
import { addCommodity, addItem } from '../cargo/hold'
import { COMMODITIES } from '../cargo/items'
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
