import { describe, expect, it } from 'vitest'
import { SHIPYARD } from '../../config/loadouts'
import { deriveShipSpec } from '../loadout'
import { createWorld } from '../world'
import { buyHull } from './shipyard'

/**
 * Верфь — правило, а не кнопка. Проверяем без рендера.
 */
describe('верфь корпусов', () => {
  /**
   * Свойство, а не число: каждый продаваемый корпус ОБЯЗАН уметь прыгать. Купив
   * корабль без привода, игрок застрял бы в системе навсегда — верфь-ловушка.
   * Оттого «Аресу» и «Каллиопе» и добавлен слот под гиперпривод.
   */
  it('каждый корпус на верфи умеет прыгать', () => {
    for (const offer of SHIPYARD) {
      const spec = deriveShipSpec(offer.loadout())
      expect(spec.jumpRange, offer.chassis.name).toBeGreaterThan(0)
    }
  })

  it('взял корпус — сменилась сборка и корабль заправлен; только у причала', () => {
    const world = createWorld()
    const ares = SHIPYARD.find((o) => o.chassis.id === 'sidewinder')!

    // В пустоте корпус не сменить: верфь есть только у станции.
    world.docked = false
    expect(buyHull(world, ares.loadout(), 0)).toBe('not-docked')
    expect(world.player.loadout.chassis.id).toBe('aurora_mk3')

    world.docked = true
    world.player.hull = 1
    expect(buyHull(world, ares.loadout(), 0)).toBeNull()
    expect(world.player.loadout.chassis.id).toBe('sidewinder')
    // Свежий корабль заправлен под завязку: корпус, щит и заряд привода — на максимум.
    expect(world.player.hull).toBe(world.player.spec.hull.hull)
    expect(world.player.jumpCharge).toBe(world.player.spec.jumpRange)
  })

  it('не хватает денег — корпус не меняется', () => {
    const world = createWorld()
    world.docked = true
    world.credits = 0
    const demeter = SHIPYARD.find((o) => o.chassis.id === 'freighter')!
    expect(buyHull(world, demeter.loadout(), 1)).toBe('no-money')
    expect(world.player.loadout.chassis.id).toBe('aurora_mk3')
  })
})
