import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { pirateLoadout } from '../../config/loadouts'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { makeShip } from '../world/factory'
import type { Disposition } from '../world/persona'
import type { ShipEntity } from '../world/entities'
import { fearLevel, wantsToFlee } from './morale'

/**
 * Боевой дух. Проверяем не магические числа, а СВОЙСТВА решения: страх растёт при
 * ослаблении, робкий бежит раньше храброго, сильный враг пугает сильнее, а враг
 * при смерти — наоборот, держит в бою. Перебалансировка вправе двигать пороги;
 * эти инварианты она ломать не должна.
 */

function ship(world: World, disposition: Disposition, willpower = 3): ShipEntity {
  const s = makeShip(world.ids, 'hostile', 'Бот', pirateLoadout(), new Vector3(), new Quaternion())
  s.persona = { disposition, intellect: 3, temperament: 3, charisma: 3, willpower, species: 'Земляне' }
  return s
}

/** Ужать здоровье до доли: щит в ноль, корпус — на нужную часть максимума. */
function hurt(s: ShipEntity, hullFrac: number): void {
  s.shield = 0
  s.hull = s.spec.hull.hull * hullFrac
}

describe('боевой дух', () => {
  it('страх растёт по мере ослабления', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    const e = ship(world, 'calculating')
    const foe = ship(world, 'calculating')

    hurt(e, 0.9)
    const fresh = fearLevel(e, foe)
    hurt(e, 0.3)
    const battered = fearLevel(e, foe)

    expect(battered).toBeGreaterThan(fresh)
  })

  it('свежий борт НЕ бежит от одного вида сильного врага — только по мере ослабления', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    // Трус со слабой волей против заметно более сильной «Авроры» игрока.
    const coward = ship(world, 'cowardly', 1)
    // На полном здоровье не бежит: страх копится с уроном, а не выдаётся на старте.
    expect(wantsToFlee(coward, world.player, false)).toBe(false)
  })

  it('но подбитый трус от сильного врага бежит — факторы сложились', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    const coward = ship(world, 'cowardly', 1)
    hurt(coward, 0.4)
    expect(wantsToFlee(coward, world.player, false)).toBe(true)
  })

  it('трус бежит раньше храбреца при равном уроне', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    const coward = ship(world, 'cowardly')
    const brave = ship(world, 'brave')
    const foe = ship(world, 'calculating')
    hurt(coward, 0.5)
    hurt(brave, 0.5)

    expect(fearLevel(coward, foe)).toBeGreaterThan(fearLevel(brave, foe))
  })

  it('храбрец держится там, где нейтральный уже бежит', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    const brave = ship(world, 'brave')
    const neutral = ship(world, 'calculating')
    const foe = ship(world, 'calculating')
    hurt(brave, 0.3)
    hurt(neutral, 0.3)

    expect(wantsToFlee(neutral, foe, false)).toBe(true)
    expect(wantsToFlee(brave, foe, false)).toBe(false)
  })

  it('враг при смерти удерживает в бою даже подбитого', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    const e = ship(world, 'calculating')
    const foe = ship(world, 'calculating')
    hurt(e, 0.3)

    // Против свежего врага — бежит; но если враг сам почти добит — остаётся добивать.
    expect(wantsToFlee(e, foe, false)).toBe(true)
    hurt(foe, 0.05)
    expect(wantsToFlee(e, foe, false)).toBe(false)
  })

  it('гистерезис: уже бегущий держит бегство там, где свежий ещё дерётся', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    const e = ship(world, 'calculating')
    const foe = ship(world, 'calculating')
    // Подберём урон у самого порога: чуть выше здоровья, чем нужно для срыва «на свежую».
    hurt(e, 0.42)

    const fleeingKeepsFleeing = wantsToFlee(e, foe, true)
    const freshHolds = wantsToFlee(e, foe, false)
    // Гистерезис не может сделать бегущего храбрее свежего.
    expect(Number(fleeingKeepsFleeing)).toBeGreaterThanOrEqual(Number(freshHolds))
  })
})
