import { describe, expect, it } from 'vitest'
import { SHOP } from '../../config/station'
import { SHIPYARD } from '../../config/loadouts'
import { COMMODITIES } from '../cargo/items'
import { createWorld } from '../world'
import { buyCommodity, commodityHeld, localSettlement, masterClass, sellCommodity } from './shop'
import { hullPurchase, hullTradeIn } from './shipyard'

/**
 * Частичная продажа стопки товара (для ползунка «продать столько-то»). Проверяем
 * СВОЙСТВА: единицы убывают ровно на проданное, costBasis режется пропорционально
 * остатку, кредиты растут на выручку, а пустая стопка исчезает — не превращаясь в
 * призрак нулевого веса.
 */
describe('частичная продажа товара', () => {
  it('продаёт часть стопки: единицы и costBasis тают пропорционально, кредиты растут', () => {
    const world = createWorld()
    world.credits = 1_000_000
    world.player.hold.capacity = 100 // место под груз, чтобы покупка не упёрлась в трюм
    const food = COMMODITIES.FOOD
    buyCommodity(world, world.player, food, 10)

    const stack = () =>
      world.player.hold.items.find((i) => i.kind === 'commodity' && i.commodity.id === food.id)
    const s0 = stack()!
    if (s0.kind !== 'commodity') throw new Error('стопка товара ожидалась')
    const basisBefore = s0.costBasis!
    const before = world.credits

    const revenue = sellCommodity(world, world.player, food, 4)
    expect(revenue).toBeGreaterThan(0)
    expect(world.credits).toBe(before + revenue)

    const s1 = stack()
    expect(s1?.kind).toBe('commodity')
    if (s1?.kind !== 'commodity') throw new Error('остаток стопки ожидался')
    expect(s1.units).toBe(6)
    // Осталось 6 из 10 — цена входа обязана хранить basis лишь этих шести.
    expect(s1.costBasis).toBe(Math.round(basisBefore * (6 / 10)))
  })

  it('продажа всего остатка (или больше) убирает стопку, а не оставляет нулевую', () => {
    const world = createWorld()
    world.credits = 1_000_000
    world.player.hold.capacity = 100
    const food = COMMODITIES.FOOD
    buyCommodity(world, world.player, food, 5)

    // Просим больше, чем есть, — берёт сколько есть и чистит стопку.
    sellCommodity(world, world.player, food, 999)
    expect(commodityHeld(world.player, food)).toBe(0)
    expect(world.player.hold.items.some((i) => i.kind === 'commodity' && i.commodity.id === food.id)).toBe(false)
  })
})

/**
 * Зачёт старого корпуса при покупке нового. Проверяем СВОЙСТВА, а не числа: битый борт
 * принимают дешевле целого, коэффициент — из класса мастерской, а доплата = цена нового
 * минус зачёт. Конкретные суммы переживут перебалансировку `TRADE_IN_BY_CLASS`.
 */
describe('зачёт корпуса при покупке', () => {
  it('битый корпус принимают дешевле целого', () => {
    const world = createWorld()
    const p = world.player
    p.hull = p.spec.hull.hull // целый
    const full = hullTradeIn(world, p)
    p.hull = Math.max(1, Math.round(p.spec.hull.hull * 0.25)) // побит
    const beat = hullTradeIn(world, p)
    expect(full).toBeGreaterThan(0)
    expect(beat).toBeLessThan(full)
  })

  it('зачёт = цена рамы × состояние × классовый коэффициент мастеров', () => {
    const world = createWorld()
    const p = world.player
    p.hull = p.spec.hull.hull // состояние 1.0
    const factor = SHOP.TRADE_IN_BY_CLASS[masterClass(localSettlement(world))]
    expect(hullTradeIn(world, p)).toBe(Math.round(p.loadout.chassis.cost * factor))
  })

  it('доплата = каталожная цена нового минус зачёт старого', () => {
    const world = createWorld()
    world.docked = true
    const p = world.player
    const target = SHIPYARD.find((o) => o.chassis.id !== p.loadout.chassis.id)!.chassis
    const q = hullPurchase(world, target)
    expect(q.price).toBe(target.cost)
    expect(q.net).toBe(q.price - q.tradeIn)
  })
})
