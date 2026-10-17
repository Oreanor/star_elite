import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { systemDefFor } from '../galaxy/jump'
import { COMMODITIES } from '../cargo/items'
import { createWorld } from '../world'
import { buyToHold, stationStock } from './shop'
import { buyCommodity, sellCommodity, sellItem } from './trade'

/**
 * ЭКОНОМИКА БЕЗ ВЕЧНОГО ДВИГАТЕЛЯ. Купить и тут же продать на той же станции не должно давать
 * ни кредита прибыли — ни модуль, ни товар. Иначе любая правка цены (наценка, тех, запас,
 * распродажа) может тихо открыть бесконечные деньги, и баланс игры рушится. Проверяем свойство
 * на всех причалах десятков систем, а не на одном числе.
 */
function* stationsOf(count: number) {
  for (let index = 0; index < count; index++) {
    const def = systemDefFor(index, GALAXY.SEED)
    const world = createWorld({ ...def, patrols: [], belt: null })
    for (const station of world.bodies.filter((b) => b.kind === 'station')) {
      world.player.state.pos.copy(station.pos)
      world.docked = true
      yield { world, label: `${world.systemName} / ${station.name}` }
    }
  }
}

describe('нет прибыли на перепродаже на месте', () => {
  it('модуль: купил в трюм и продал — денег не больше, чем было', () => {
    let checked = 0
    for (const { world, label } of stationsOf(30)) {
      for (const m of stationStock(world)) {
        world.credits = 10_000_000
        world.player.hold.items.length = 0
        const before = world.credits
        if (buyToHold(world, world.player, m) !== null) continue
        sellItem(world, world.player, world.player.hold.items.length - 1)
        expect(world.credits, `${label}: ${m.id}`).toBeLessThanOrEqual(before)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(50)
  })

  it('товар: купил тонну и продал — денег не больше, чем было', () => {
    let checked = 0
    for (const { world, label } of stationsOf(30)) {
      for (const c of Object.values(COMMODITIES)) {
        if (c.contraband || c.unitMass <= 0) continue
        world.credits = 10_000_000
        world.player.hold.items.length = 0
        const before = world.credits
        if (buyCommodity(world, world.player, c, 1) <= 0) continue
        sellCommodity(world, world.player, c, 1)
        expect(world.credits, `${label}: ${c.id}`).toBeLessThanOrEqual(before)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(50)
  })
})
