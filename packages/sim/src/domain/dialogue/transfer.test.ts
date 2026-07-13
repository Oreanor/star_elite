import { describe, expect, it } from 'vitest'
import { COMMODITIES } from '../cargo'
import { addCommodity } from '../cargo/hold'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import type { ShipEntity } from '../world/entities'
import { applyTransfer } from './transfer'

/**
 * Сделки словами. Модель ловит договорённость и шлёт скрытую команду; домен
 * двигает добро — но только то, что реально есть и влезает. Врать про полный трюм
 * или уводить счёт в минус нельзя, сколько бы модель ни пообещала.
 */

function scene(): { world: World; ship: ShipEntity } {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -200], spread: 0, faction: 'neutral', name: 'Торговец' }],
  })
  return { world, ship: world.ships[0]! }
}

const held = (world: World, id: string): number =>
  world.player.hold.items.reduce((n, i) => (i.kind === 'commodity' && i.commodity.id === id ? n + i.units : n), 0)

describe('сделки', () => {
  it('игрок отдаёт товар — не больше своего запаса и чужого трюма', () => {
    const { world, ship } = scene()
    // Ёмкость трюма игрока задаём явно: тест про правила сделки, а не про тюнинг
    // стартовой грузоподъёмности — иначе он ломается от любой перебалансировки корпуса.
    world.player.hold.capacity = 40
    addCommodity(world.player.hold, COMMODITIES.FOOD, 20)
    ship.hold.capacity = 8

    const r = applyTransfer(world, ship, { direction: 'toThem', commodityId: 'food', units: 50 })
    expect(r.units).toBe(8) // влезло только восемь
    expect(held(world, 'food')).toBe(12)
    expect(ship.hold.items.reduce((n, i) => (i.kind === 'commodity' ? n + i.units : n), 0)).toBe(8)
  })

  it('бот отдаёт долю деньгами — счёт растёт', () => {
    const { world, ship } = scene()
    const before = world.credits
    const r = applyTransfer(world, ship, { direction: 'toYou', credits: 500 })
    expect(r.credits).toBe(500)
    expect(world.credits).toBe(before + 500)
  })

  it('игрок платит не больше, чем есть на счету', () => {
    const { world, ship } = scene()
    world.credits = 300
    const r = applyTransfer(world, ship, { direction: 'toThem', credits: 1000 })
    expect(r.credits).toBe(300)
    expect(world.credits).toBe(0)
  })

  it('нельзя передать то, чего нет в трюме', () => {
    const { world, ship } = scene()
    const r = applyTransfer(world, ship, { direction: 'toThem', commodityId: 'metals', units: 5 })
    expect(r.units).toBe(0)
    expect(r.commodityName).toBeNull()
  })
})
