import { describe, expect, it } from 'vitest'
import { SHIELD_STANDARD } from '../../config/modules'
import { addItem } from '../cargo/hold'
import { isShield, type ShieldModule } from '../loadout'
import { createWorld } from '../world'
import { canUpgrade, upgradeLevel, upgradeModule } from './shop'

/**
 * Прокачка модуля. Проверяем СВОЙСТВА, а не магические числа: усиление растит
 * характеристику, копия расходуется, денежная дорога слабее и платная, потолок держит.
 */

/** Установленный щит игрока как ShieldModule — стартовый SHIELD_STANDARD. */
function playerShield(world: ReturnType<typeof createWorld>): ShieldModule {
  const shield = world.player.loadout.internals.find(isShield)
  if (!shield) throw new Error('у стартовой Кобры обязан быть щит')
  return shield
}

describe('прокачка модуля', () => {
  it('копия из трюма усиливает щит на +50% и сама расходуется', () => {
    const world = createWorld()
    const before = world.player.spec.hull.shield
    addItem(world.player.hold, { kind: 'module', module: SHIELD_STANDARD })
    const holdBefore = world.player.hold.items.length

    expect(upgradeModule(world, world.player, playerShield(world), true)).toBeNull()

    // Защита выросла примерно в полтора раза — считается через spec, не назначается.
    expect(world.player.spec.hull.shield).toBeCloseTo(before * 1.5, 5)
    // Копия ушла из трюма: ею и заплатили.
    expect(world.player.hold.items.length).toBe(holdBefore - 1)
    expect(upgradeLevel(playerShield(world))).toBeCloseTo(0.5, 5)
  })

  it('без копии качает слабее (+25%) и списывает кредиты', () => {
    const world = createWorld()
    world.credits = 1_000_000 // денежная дорога платная — на неё нужны кредиты
    const before = world.player.spec.hull.shield
    const money = world.credits

    expect(upgradeModule(world, world.player, playerShield(world), false)).toBeNull()

    expect(world.player.spec.hull.shield).toBeCloseTo(before * 1.25, 5)
    expect(world.credits).toBeLessThan(money)
  })

  it('прокачка не трогает массу: усиливается заявленная ось, а не манёвренность тайком', () => {
    const world = createWorld()
    const mass = world.player.spec.mass
    upgradeModule(world, world.player, playerShield(world), false)
    expect(world.player.spec.mass).toBeCloseTo(mass, 5)
  })

  it('нет копии — по копейной дороге отказ, деньги не трогаются', () => {
    const world = createWorld()
    expect(canUpgrade(world, world.player, playerShield(world), true)).toBe('no-copy')
  })

  it('улучшать можно только раз: повторная прокачка отклонена', () => {
    const world = createWorld()
    world.credits = 10_000_000

    expect(upgradeModule(world, world.player, playerShield(world), false)).toBeNull()
    // Второй раз тот же модуль не берут — ни за деньги, ни копией.
    expect(canUpgrade(world, world.player, playerShield(world), false)).toBe('maxed')
    expect(canUpgrade(world, world.player, playerShield(world), true)).toBe('maxed')
    expect(upgradeModule(world, world.player, playerShield(world), false)).toBe('maxed')
  })
})
