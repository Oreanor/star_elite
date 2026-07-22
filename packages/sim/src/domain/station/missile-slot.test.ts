import { describe, expect, it } from 'vitest'
import { auroraOneLoadout } from '../../config/loadouts'
import { DRONE_BAY, MISSILE_PYLON } from '../../config/modules'
import { isDrone, isMissile } from '../loadout'
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
  const world = createWorld()
  world.player.loadout = auroraOneLoadout()
  refreshSpec(world.player)
  return world
}

describe('ракетный (мунишн) слот', () => {
  it('у стартовой Авроры пилоны ЕСТЬ, но пустые: ракеты покупаются', () => {
    const world = createWorld()
    expect(missilePylonIndices(world.player).length).toBeGreaterThan(0)
    expect(installedMissile(world.player)).toBeNull()
    expect(world.player.loadout.weapons.some((w) => w != null && isMissile(w))).toBe(false)
    expect(world.player.loadout.weapons.some((w) => w != null && isDrone(w))).toBe(false)
  })

  it('тот же тип на всех пилонах повторно не ставится', () => {
    const world = missileWorld()
    world.credits = 10_000_000
    expect(armMissiles(world, world.player, MISSILE_PYLON)).toBe('already-installed')
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
