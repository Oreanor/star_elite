import { describe, expect, it } from 'vitest'
import { COMMODITIES } from '../cargo'
import { addCommodity, addFigurineSpecimens } from '../cargo/hold'
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
  const ship = world.ships[0]!
  // Коллекционеры на спавне тащат статуэтки — для чистых сделок сбрасываем трюм.
  ship.hold.items = []
  return { world, ship }
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

  it('покупка статуэтки: груз тебе, деньги с тебя; экземпляры не теряются', () => {
    const { world, ship } = scene()
    world.player.hold.capacity = 0 // масса 0 — всё равно влезает
    world.credits = 10_000
    addFigurineSpecimens(ship.hold, [
      { titleId: 'mercy', variant: 0, radius: 20_000 },
      { titleId: 'sun', variant: 1, radius: 30_000 },
    ])

    const r = applyTransfer(world, ship, {
      direction: 'toYou',
      commodityId: 'figurine',
      units: 1,
      credits: 5000,
    })
    expect(r.units).toBe(1)
    expect(r.credits).toBe(5000)
    expect(world.credits).toBe(5000)
    expect(held(world, 'figurine')).toBe(1)
    const stack = world.player.hold.items.find(
      (i) => i.kind === 'commodity' && i.commodity.id === 'figurine',
    )
    expect(stack?.kind === 'commodity' && stack.specimens?.map((s) => s.titleId)).toEqual(['mercy'])
    expect(
      ship.hold.items
        .filter((i) => i.kind === 'commodity' && i.commodity.id === 'figurine')
        .reduce((n, i) => n + (i.kind === 'commodity' ? i.units : 0), 0),
    ).toBe(1)
    expect(
      ship.hold.items.some(
        (i) =>
          i.kind === 'commodity' &&
          i.commodity.id === 'figurine' &&
          i.specimens?.some((s) => s.titleId === 'sun'),
      ),
    ).toBe(true)
  })

  it('покупка при пустом трюме продавца — деньги не списываются', () => {
    const { world, ship } = scene()
    world.credits = 10_000
    const r = applyTransfer(world, ship, {
      direction: 'toYou',
      commodityId: 'figurine',
      units: 1,
      credits: 5000,
    })
    expect(r.units).toBe(0)
    expect(r.credits).toBe(0)
    expect(world.credits).toBe(10_000)
  })

  it('статуэтка массой 0 влезает в полный трюм', () => {
    const { world, ship } = scene()
    world.player.hold.capacity = 0
    addFigurineSpecimens(ship.hold, [{ titleId: 'dawn', variant: 2, radius: 12_000 }])
    const r = applyTransfer(world, ship, { direction: 'toYou', commodityId: 'figurine', units: 1 })
    expect(r.units).toBe(1)
    expect(held(world, 'figurine')).toBe(1)
  })
})
