import { describe, expect, it } from 'vitest'
import { SHIPYARD } from '../../config/loadouts'
import { createWorld } from '../world'
import { swapHull } from './shipyard'
import { canUpgradeHull, hullUpgradeCost, upgradeHull } from './shop'

/**
 * Апгрейд корпуса — БЕЗ предела, уровнями: качает три базовые х-ки рамы за прогрессивную
 * цену. Проверяем поведение (уровень растёт, потолок HP выше, цена дорожает, смена рамы
 * сбрасывает), а не конкретные числа — они переживут перебалансировку `SHOP.HULL_*`.
 */
describe('апгрейд корпуса', () => {
  it('поднимает уровень, растит потолок HP и списывает цену', () => {
    const world = createWorld()
    world.credits = 1_000_000
    const p = world.player
    const cost = hullUpgradeCost(p)
    const maxBefore = p.spec.hull.hull
    const creditsBefore = world.credits

    expect(upgradeHull(world, p)).toBeNull()
    expect(p.hullLevel).toBe(1)
    expect(p.spec.hull.hull).toBeGreaterThan(maxBefore) // рама стала крепче
    expect(world.credits).toBe(creditsBefore - cost)
  })

  it('цена уровня растёт с каждым разом (без предела)', () => {
    const world = createWorld()
    world.credits = 100_000_000
    const p = world.player
    const c0 = hullUpgradeCost(p)
    upgradeHull(world, p)
    const c1 = hullUpgradeCost(p)
    upgradeHull(world, p)
    const c2 = hullUpgradeCost(p)
    expect(c1).toBeGreaterThan(c0)
    expect(c2).toBeGreaterThan(c1)
  })

  it('нет денег — апгрейд не проходит, уровень не меняется', () => {
    const world = createWorld()
    world.credits = 0
    const p = world.player
    expect(canUpgradeHull(world, p)).toBe('no-money')
    expect(upgradeHull(world, p)).toBe('no-money')
    expect(p.hullLevel).toBe(0)
  })

  it('смена корпуса сбрасывает уровень апгрейда: качаешь конкретную раму', () => {
    const world = createWorld()
    world.credits = 100_000_000
    world.docked = true
    const p = world.player
    upgradeHull(world, p)
    expect(p.hullLevel).toBe(1)

    const freighter = SHIPYARD.find((o) => o.chassis.id === 'freighter')!
    expect(swapHull(world, freighter.chassis, 0)).toBeNull()
    expect(p.hullLevel).toBe(0) // новая рама заводская
  })
})
