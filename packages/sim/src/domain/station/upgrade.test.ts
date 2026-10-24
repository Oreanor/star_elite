import { describe, expect, it } from 'vitest'
import { theseusLoadout } from '../../config/loadouts'
import { findModule } from '../../config/modules'
import { refreshSpec } from '../world/factory'
import { addItem } from '../cargo/hold'
import { isMissile, isShield, type LaserModule, type MissileModule, type ShieldModule } from '../loadout'
import { createWorld } from '../world'
import { canUpgrade, upgradeCashCost, upgradeModule } from './upgrade'
import { SHOP } from '../../config/station'
import { upgradeLevel } from './moduleState'

/**
 * Прокачка модуля. Проверяем СВОЙСТВА, а не магические числа: усиление растит
 * характеристику, копия расходуется, денежная дорога слабее и платная, потолок держит.
 */

/** Установленный щит игрока. Какой именно — решает стартовая сборка. */
function playerShield(world: ReturnType<typeof createWorld>): ShieldModule {
  const shield = world.player.loadout.internals.find(isShield)
  if (!shield) throw new Error('у стартовой Авроры обязан быть щит')
  return shield
}

describe('прокачка модуля', () => {
  it('копия из трюма даёт две ступени разом и сама расходуется', () => {
    const world = createWorld()
    const before = world.player.spec.hull.shield
    const copy = findModule(playerShield(world).id)
    if (!copy) throw new Error('сток щита обязан быть в каталоге')
    addItem(world.player.hold, { kind: 'module', module: copy })
    const holdBefore = world.player.hold.items.length

    expect(upgradeModule(world, world.player, playerShield(world), true)).toBeNull()

    // Копия сильнее денег: две ступени сразу. Защита — через spec, не назначается.
    const level = SHOP.UPGRADE_COPY_STEPS * SHOP.UPGRADE_STEP
    expect(upgradeLevel(playerShield(world))).toBeCloseTo(level, 5)
    expect(Math.abs(world.player.spec.hull.shield - before * (1 + level))).toBeLessThanOrEqual(1)
    // Копия ушла из трюма: ею и заплатили.
    expect(world.player.hold.items.length).toBe(holdBefore - 1)
  })

  it('за деньги — одна ступень и списывается цена ступени', () => {
    const world = createWorld()
    world.credits = 1_000_000 // денежная дорога платная — на неё нужны кредиты
    const before = world.player.spec.hull.shield
    const money = world.credits
    const cost = upgradeCashCost(playerShield(world))

    expect(upgradeModule(world, world.player, playerShield(world), false)).toBeNull()

    expect(upgradeLevel(playerShield(world))).toBeCloseTo(SHOP.UPGRADE_STEP, 5)
    expect(world.player.spec.hull.shield).toBeGreaterThan(before)
    expect(world.credits).toBe(money - cost)
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

  it('ступени до потолка: складываются от стока, цена ступени одна, лишняя отклонена', () => {
    const world = createWorld()
    world.credits = 100_000_000
    const base = playerShield(world).capacity
    const costs = new Set<number>()
    for (let i = 0; i < SHOP.UPGRADE_MAX_STEPS; i++) {
      costs.add(upgradeCashCost(playerShield(world)))
      expect(upgradeModule(world, world.player, playerShield(world), false), `ступень ${i + 1}`).toBeNull()
    }
    // Ступени — от стока, а не процент от процента: на потолке ровно base × (1 + 20·5%).
    const top = SHOP.UPGRADE_MAX_STEPS * SHOP.UPGRADE_STEP
    expect(Math.abs(playerShield(world).capacity - base * (1 + top))).toBeLessThanOrEqual(1)
    // Цена ступени не растёт: доля цены модуля.
    expect(costs.size).toBe(1)
    // Сверх потолка — ни за деньги, ни копией.
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
    // Штатная «Ника» уходит с пустыми пилонами. Пусковая нужна установленная —
    // берём «Тесея», у него она есть с завода.
    world.player.loadout = theseusLoadout()
    refreshSpec(world.player)
    const missile = world.player.loadout.weapons.find((w): w is MissileModule => w != null && isMissile(w))
    if (!missile) throw new Error('у заводского «Тесея» есть ракетные пилоны')
    const ammoBefore = missile.ammo
    const damageBefore = missile.damage
    world.credits = 100_000_000

    // Заряды штучные: +5% от горстки ракет округляется, поэтому меряем после нескольких ступеней.
    for (let i = 0; i < 6; i++) {
      const cur = world.player.loadout.weapons.find((w): w is MissileModule => w != null && isMissile(w))!
      expect(upgradeModule(world, world.player, cur, false)).toBeNull()
    }

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

  /** Поставить модуль каталога на первую оружейную точку игрока. */
  function mountLaser(world: ReturnType<typeof createWorld>, id: string): LaserModule {
    const laser = findModule(id) as LaserModule
    const slot = world.player.loadout.weapons.findIndex((w) => w != null && w.kind === 'laser')
    world.player.loadout.weapons[slot] = laser
    refreshSpec(world.player)
    return laser
  }

  it('горный лазер качается в резку: урон растёт, КПД добычи не превышает целого камня', () => {
    // Прежде рос один КПД добычи (с потолком 1), а окно показывало урон: «5 → 5», и
    // прокачка не давала ничего вовсе. Урон целый — растёт рывками через несколько ступеней.
    const world = createWorld()
    world.credits = 100_000_000
    let laser = mountLaser(world, 'mining_1')
    const before = laser.damage
    for (let i = 0; i < SHOP.UPGRADE_MAX_STEPS; i++) {
      expect(upgradeModule(world, world.player, laser, false), `ступень ${i + 1}`).toBeNull()
      laser = world.player.loadout.weapons.find((w) => w?.id === 'mining_1') as LaserModule
    }
    expect(laser.damage).toBeGreaterThan(before)
    expect(Number.isInteger(laser.damage)).toBe(true)
    expect(laser.oreYield).toBe(1)
  })

  it('космические лучи не прокачиваются: урона у них нет', () => {
    const world = createWorld()
    world.credits = 10_000_000
    for (const id of ['cosmic_seed', 'cosmic_shatter']) {
      const laser = mountLaser(world, id)
      expect(canUpgrade(world, world.player, laser, false), id).toBe('maxed')
    }
  })
})
