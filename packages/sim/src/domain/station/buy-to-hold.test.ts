import { describe, expect, it } from 'vitest'
import { MODULE_CATALOGUE } from '../../config/modules'
import { cargoMass } from '../cargo/hold'
import { createWorld } from '../world'
import { buyToHold, priceOf } from './shop'

/**
 * Покупка «в трюм, без установки». Инварианты: деньги уходят ровно на цену, модуль
 * ложится в отсек, оснастка корабля не меняется; отказ не списывает ни кредита.
 */
describe('покупка модуля в трюм', () => {
  const shield = MODULE_CATALOGUE.find((m) => m.kind === 'shield' && m.cost > 0)!

  it('модуль в трюме, кредиты меньше на цену, оснастка та же', () => {
    const world = createWorld()
    const ship = world.player
    world.credits = priceOf(shield) * 2
    const before = world.credits
    const internals = [...ship.loadout.internals]

    expect(buyToHold(world, ship, shield)).toBeNull()
    expect(world.credits).toBe(before - priceOf(shield))
    const item = ship.hold.items.find((i) => i.kind === 'module' && i.module.id === shield.id)
    expect(item).toBeDefined()
    // Цена входа записана — иначе на продаже купленное читалось бы «находкой».
    expect(item?.kind === 'module' ? item.costBasis : undefined).toBe(priceOf(shield))
    expect(ship.loadout.internals).toEqual(internals)
  })

  it('нет денег — отказ, ничего не меняется', () => {
    const world = createWorld()
    world.credits = priceOf(shield) - 1
    const items = world.player.hold.items.length

    expect(buyToHold(world, world.player, shield)).toBe('no-money')
    expect(world.credits).toBe(priceOf(shield) - 1)
    expect(world.player.hold.items.length).toBe(items)
  })

  it('нет места в отсеке — отказ, деньги на месте', () => {
    const world = createWorld()
    const ship = world.player
    world.credits = priceOf(shield) * 2
    const before = world.credits
    // Отсек «полон»: свободного меньше, чем весит щит.
    ship.hold.capacity = cargoMass(ship.hold) + shield.mass / 2

    expect(buyToHold(world, ship, shield)).toBe('no-room')
    expect(world.credits).toBe(before)
  })
})
