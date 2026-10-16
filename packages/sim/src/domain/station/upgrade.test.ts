import { describe, expect, it } from 'vitest'
import { auroraOneLoadout } from '../../config/loadouts'
import { SHIELD_STANDARD } from '../../config/modules'
import { refreshSpec } from '../world/factory'
import { addItem } from '../cargo/hold'
import { isMissile, isShield, type MissileModule, type ShieldModule } from '../loadout'
import { createWorld } from '../world'
import { canUpgrade, upgradeCashCost, upgradeModule } from './upgrade'
import { upgradeLevel } from './moduleState'

/**
 * Прокачка модуля. Проверяем СВОЙСТВА, а не магические числа: усиление растит
 * характеристику, копия расходуется, денежная дорога слабее и платная, потолок держит.
 */

/** Установленный щит игрока как ShieldModule — стартовый SHIELD_STANDARD. */
function playerShield(world: ReturnType<typeof createWorld>): ShieldModule {
  const shield = world.player.loadout.internals.find(isShield)
  if (!shield) throw new Error('у стартовой Авроры обязан быть щит')
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
    expect(world.player.spec.hull.shield).toBe(Math.round(before * 1.5))
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

    expect(world.player.spec.hull.shield).toBe(Math.round(before * 1.25))
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

  it('улучшать можно трижды: шаги складываются, дорожают, четвёртый отклонён', () => {
    const world = createWorld()
    world.credits = 10_000_000
    const base = playerShield(world).capacity
    const costs: number[] = []
    for (let i = 0; i < 3; i++) {
      costs.push(upgradeCashCost(playerShield(world)))
      expect(upgradeModule(world, world.player, playerShield(world), false), `шаг ${i + 1}`).toBeNull()
    }
    // Три денежных шага по +25% — от стока, а не процент от процента.
    expect(playerShield(world).capacity).toBe(Math.round(base * 1.75))
    // Каждый следующий шаг дороже предыдущего.
    expect(costs[1]!).toBeGreaterThan(costs[0]!)
    expect(costs[2]!).toBeGreaterThan(costs[1]!)
    // Четвёртый раз — ни за деньги, ни копией.
    expect(canUpgrade(world, world.player, playerShield(world), false)).toBe('maxed')
    expect(canUpgrade(world, world.player, playerShield(world), true)).toBe('maxed')
    expect(upgradeModule(world, world.player, playerShield(world), false)).toBe('maxed')
  })

  it('улучшенная броня сразу добавляет прочность корпусу — без «ремонта»', () => {
    const world = createWorld()
    world.credits = 10_000_000
    const p = world.player
    const plate = p.loadout.internals.find((m) => m.kind === 'armour')
    if (!plate) return
    expect(p.hull).toBe(p.spec.hull.hull)
    expect(upgradeModule(world, p, plate, false)).toBeNull()
    expect(p.hull).toBe(p.spec.hull.hull)
  })

  // Ракета — расходник: её не чинят, но пусковую УЛУЧШАЮТ бо́льшим боезапасом, не уроном.
  it('прокачка ракетной пусковой растит боезапас, а не урон', () => {
    const world = createWorld()
    // Штатный «Spiritus Sanctus» без пилонов (это решение, см. missile-slot.test.ts),
    // а прокачивать нужно установленную пусковую — берём серийную «Аврору».
    world.player.loadout = auroraOneLoadout()
    refreshSpec(world.player)
    const missile = world.player.loadout.weapons.find((w): w is MissileModule => w != null && isMissile(w))
    if (!missile) throw new Error('у серийной «Авроры» есть ракетные пилоны')
    const ammoBefore = missile.ammo
    const damageBefore = missile.damage
    world.credits = 10_000_000

    expect(upgradeModule(world, world.player, missile, false)).toBeNull()

    const upgraded = world.player.loadout.weapons.find((w): w is MissileModule => w != null && isMissile(w))!
    expect(upgraded.ammo).toBeGreaterThan(ammoBefore) // заряда стало больше
    expect(upgraded.damage).toBe(damageBefore) // урон не тронут
  })
})

describe('маневровые', () => {
  it('улучшение растит момент, но не предел скорости разворота и крена', () => {
    // Пойманное: три шага давали +75% к пределу, крен доходил до 4.6 рад/с — корабль
    // закручивало, нос не держался прямо, целиться не мог ни пилот, ни бот.
    const world = createWorld()
    world.credits = 10_000_000
    const p = world.player
    const rcs = () => p.loadout.internals.find((m) => m.kind === 'thrusters')!
    const before = rcs()
    if (before.kind !== 'thrusters') return
    const rateBefore = [...before.maxRate]
    const torqueBefore = before.torque[0]
    for (let i = 0; i < 3; i++) upgradeModule(world, p, rcs(), false)
    const after = rcs()
    if (after.kind !== 'thrusters') return
    expect(after.torque[0]).toBeGreaterThan(torqueBefore)
    expect([...after.maxRate]).toEqual(rateBefore)
  })
})
