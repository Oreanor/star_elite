import { describe, expect, it } from 'vitest'
import { veteranWorld } from '../../testkit'
import { missileRackOf } from '../../config/chassis'
import { auroraOneLoadout } from '../../config/loadouts'
import { DRONE_BAY } from '../../config/modules'
import { isDrone, isMissile } from '../loadout'
import { missileRoom, missileStock } from '../combat/ordnance'
import { cargoMass } from '../cargo/hold'
import { buyMissiles } from './shop'
import { createWorld } from '../world'
import { refreshSpec } from '../world/factory'
import {
  armMissiles,
  installedMissile,
  missilePylonIndices,
  sellMissiles,
  stripMissiles,
} from './shop'

/**
 * Ракеты — ОДИН мунишн-слот на всю подвеску: один тип на всех пилонах, операции по слоту
 * целиком. Дрон-ракеты — просто ДРУГОЙ ТИП того же слота (ставятся взамен обычных).
 */

/** Множество id по всем пилонам — размер 1 значит «один тип на слоте» (инвариант). */
function pylonTypes(world: ReturnType<typeof createWorld>): Set<string> {
  const ids = new Set<string>()
  for (const i of missilePylonIndices(world.player)) {
    const w = world.player.loadout.weapons[i]
    if (w) ids.add(w.id)
  }
  return ids
}

/** Операции слота — на серийной «Авроре» С УЖЕ ВСТАВЛЕННЫМИ ракетами: стартовая идёт с пустыми пилонами. */
function missileWorld(): ReturnType<typeof createWorld> {
  const world = veteranWorld()
  world.player.loadout = auroraOneLoadout()
  refreshSpec(world.player)
  return world
}

describe('ракетный (мунишн) слот', () => {
  /**
   * Стартовый корабль вылетает с заводской выдачей в ТРЮМЕ, по тонне на ракету.
   * Раньше это был потолок обоймы на пилоне; теперь потолок — грузовой отсек,
   * а паспорт `ammo` — только сколько кладут с верфи.
   */
  it('стартовый корабль вылетает с ракетами в трюме', () => {
    const world = createWorld()
    const pylons = missilePylonIndices(world.player)
    expect(pylons.length).toBeGreaterThan(0)
    expect(installedMissile(world.player)).not.toBeNull()

    const perPylon = installedMissile(world.player)!.kind === 'missile' ? (installedMissile(world.player) as { ammo: number }).ammo : 0
    const stock = missileStock(world.player)
    expect(stock).toBe(pylons.length * perPylon)
    // Тонна за штуку: в трюме больше ничего нет, масса груза равна числу ракет.
    expect(cargoMass(world.player.hold)).toBe(stock)
    expect(world.player.missileReady).toBe(Math.min(missileRackOf(world.player.loadout.chassis), stock))
    // Дрон-ракеты — покупные: их с завода не ставят.
    expect(world.player.loadout.weapons.some((w) => w != null && isDrone(w))).toBe(false)
  })

  it('ракет можно купить сколько влезет в трюм, и ни одной сверх', () => {
    const world = createWorld()
    world.credits = 1_000_000
    const room = missileRoom(world.player)
    expect(room).toBeGreaterThan(0)
    expect(buyMissiles(world, world.player, 100_000)).toBe(room)
    expect(missileRoom(world.player)).toBe(0)
    expect(buyMissiles(world, world.player, 1)).toBe(0)
    expect(world.player.missileReady).toBe(4)
  })

  it('тот же тип на всех пилонах повторно не ставится', () => {
    const world = missileWorld()
    world.credits = 10_000_000
    const fitted = installedMissile(world.player)
    expect(fitted).not.toBeNull()
    expect(armMissiles(world, world.player, fitted!)).toBe('already-installed')
  })

  it('дрон-ракеты встают ВЗАМЕН обычных: слот держит один тип', () => {
    const world = missileWorld()
    world.credits = 10_000_000
    expect(armMissiles(world, world.player, DRONE_BAY)).toBeNull()

    const types = pylonTypes(world)
    expect(types.size).toBe(1) // один тип на всех
    expect(types.has(DRONE_BAY.id)).toBe(true)
    // Все пилоны заполнены дроном, обычных ракет не осталось.
    const munition = installedMissile(world.player)
    expect(munition && isDrone(munition)).toBe(true)
    expect(world.player.loadout.weapons.some((w) => w != null && isMissile(w))).toBe(false)
  })

  it('снять слот — очищает ВСЕ пилоны', () => {
    const world = missileWorld()
    expect(installedMissile(world.player)).not.toBeNull()
    expect(stripMissiles(world.player)).toBeNull()
    expect(installedMissile(world.player)).toBeNull()
    expect(pylonTypes(world).size).toBe(0)
  })

  it('продать слот — очищает пилоны и даёт кредиты один раз', () => {
    const world = missileWorld()
    const money = world.credits
    expect(sellMissiles(world, world.player)).toBeNull()
    expect(installedMissile(world.player)).toBeNull()
    expect(world.credits).toBeGreaterThan(money)
  })
})
