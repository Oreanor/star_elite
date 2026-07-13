import { describe, expect, it } from 'vitest'
import { SHIPYARD } from '../../config/loadouts'
import { createWorld } from '../world'
import { swapHull } from './shipyard'
import { canUpgradeHullStat, hullStatUpgradeCost, upgradeHullStat } from './shop'

/**
 * Прокачка собственных х-к рамы — РАЗОВАЯ, по осям (HP / грузоподъёмность / аукс): каждую
 * можно усилить один раз на +25%. Проверяем поведение (ось усилилась, потолок вырос, цена
 * списана, второй раз отказ, смена рамы сбрасывает), а не числа — переживут перебалансировку.
 */
describe('прокачка х-к корпуса', () => {
  it('усиливает ось: растит потолок HP и списывает цену', () => {
    const world = createWorld()
    world.credits = 1_000_000
    const p = world.player
    const cost = hullStatUpgradeCost(p)
    const maxBefore = p.spec.hull.hull
    const creditsBefore = world.credits

    expect(upgradeHullStat(world, p, 'hull')).toBeNull()
    expect(p.hullUp.hull).toBe(true)
    expect(p.spec.hull.hull).toBeGreaterThan(maxBefore) // рама стала крепче
    expect(world.credits).toBe(creditsBefore - cost)
  })

  it('одну ось нельзя усилить дважды', () => {
    const world = createWorld()
    world.credits = 100_000_000
    const p = world.player
    expect(upgradeHullStat(world, p, 'cargo')).toBeNull()
    // Второй раз по той же оси — отказ, деньги не списываются.
    expect(canUpgradeHullStat(world, p, 'cargo')).toBe('already')
    const credits = world.credits
    expect(upgradeHullStat(world, p, 'cargo')).toBe('already')
    expect(world.credits).toBe(credits)
    // Другая ось при этом ещё доступна.
    expect(canUpgradeHullStat(world, p, 'aux')).toBeNull()
  })

  it('нет денег — прокачка не проходит, ось не меняется', () => {
    const world = createWorld()
    world.credits = 0
    const p = world.player
    expect(canUpgradeHullStat(world, p, 'aux')).toBe('no-money')
    expect(upgradeHullStat(world, p, 'aux')).toBe('no-money')
    expect(p.hullUp.aux).toBe(false)
  })

  it('смена корпуса сбрасывает все прокачки: качаешь конкретную раму', () => {
    const world = createWorld()
    world.credits = 100_000_000
    world.docked = true
    const p = world.player
    upgradeHullStat(world, p, 'hull')
    upgradeHullStat(world, p, 'cargo')
    expect(p.hullUp.hull).toBe(true)

    const freighter = SHIPYARD.find((o) => o.chassis.id === 'freighter')!
    expect(swapHull(world, freighter.chassis, 0)).toBeNull()
    expect(p.hullUp).toEqual({ hull: false, cargo: false, aux: false }) // новая рама заводская
  })
})
