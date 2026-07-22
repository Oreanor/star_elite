import { describe, expect, it } from 'vitest'
import { findModule } from '../../config/modules'
import { addItem } from '../cargo/hold'
import { COMMODITIES } from '../cargo/items'
import { isShield } from '../loadout'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { refreshSpec } from '../world/factory'
import type { Acquaintance } from '../world/acquaintance'
import { applyPlayerSave, serializePlayer } from './player'
import { emptyPlan } from '../world/contactPlan'

/**
 * Инвариант фазы 0.1: round-trip. Сериализовали живого игрока и наложили сейв на
 * ЧИСТЫЙ мир — долговечное состояние обязано совпасть, а тяжёлый спек — вывестись
 * заново из каталога. Это фундамент и сохранений, и сетевой правды: если round-trip
 * теряет данные, теряет их и автосейв на станции.
 */

/** Живой игрок с историей: побит, гружён, прокачан, потратил ракеты, кое с кем знаком. */
function playedWorld(): World {
  const w = createWorld(STARTER_SYSTEM)
  const p = w.player

  w.credits = 123_456
  w.score = 42
  p.auxEnergy = 25

  // Прокачка ЭКЗЕМПЛЯРА: клонируем модуль сборки, не трогая синглтон каталога.
  const shieldIdx = p.loadout.internals.findIndex(isShield)
  const shield = p.loadout.internals[shieldIdx]!
  p.loadout.internals[shieldIdx] = { ...shield, upgrade: 0.5 }

  // Груз с личной ценой входа (costBasis) и без неё (трофей).
  addItem(p.hold, { kind: 'commodity', commodity: COMMODITIES.FOOD, units: 7, costBasis: 300 })
  addItem(p.hold, { kind: 'commodity', commodity: COMMODITIES.MINERALS, units: 3 })

  // Сборка и груз сменились — пересобираем спек, как это делает игра на событие.
  // Иначе спек остался бы дефолтным (без прокачки и массы груза), и сравнивать
  // было бы не с чем.
  refreshSpec(p)

  // Урон — уже от обновлённого потолка сборки.
  p.hull = p.spec.hull.hull * 0.6
  p.shield = p.spec.hull.shield * 0.3
  p.energy = p.spec.power.capacity * 0.5

  // Потрачен боезапас первой подвески с ракетами.
  const missileGun = p.guns.find((g) => g.ammo > 0)
  if (missileGun) missileGun.ammo -= 1

  const met: Acquaintance = {
    id: w.ids.next(),
    name: 'Вэйл',
    persona: p.persona,
    faction: 'neutral',
    chassisId: 'sidewinder',
    kindId: 'trader',
    systemIndex: 777,
    boundFor: null,
    roaming: true,
    meetings: 2,
    relationship: 'friendly',
    history: [
      { kind: 'met', at: 0 },
      { kind: 'deal', at: 12, toPlayer: true, credits: 5000, commodityName: null, units: 0 },
      { kind: 'note', at: 20, text: 'обещал придержать для меня редкую руду' },
    ],
    alive: true,
    credits: 12_000,
    savedLoadout: null,
    plan: emptyPlan(),
    entrusted: [],
  }
  w.acquaintances.push(met)

  return w
}

const loadoutShape = (w: World) => ({
  chassis: w.player.loadout.chassis.id,
  internals: w.player.loadout.internals.map((m) => ({ id: m.id, upgrade: m.upgrade })),
  weapons: w.player.loadout.weapons.map((wp) => (wp ? wp.id : null)),
})

const holdShape = (w: World) =>
  w.player.hold.items
    .filter((i) => i.kind === 'commodity')
    .map((i) => (i.kind === 'commodity' ? { id: i.commodity.id, units: i.units, costBasis: i.costBasis } : null))

describe('round-trip сейва игрока', () => {
  it('переносит корабль, кошелёк, личность и знакомства в чистый мир без потерь', () => {
    const src = playedWorld()
    const save = serializePlayer(src)

    const dst = createWorld(STARTER_SYSTEM)
    applyPlayerSave(dst, save)

    // Скаляры мира.
    expect(dst.credits).toBe(src.credits)
    expect(dst.score).toBe(src.score)
    expect(dst.galaxySeed).toBe(src.galaxySeed)
    expect(dst.systemIndex).toBe(src.systemIndex)

    // Личность и реестр знакомств — до последнего поля.
    expect(dst.player.persona).toEqual(src.player.persona)
    expect(dst.acquaintances).toEqual(src.acquaintances)

    // Сборка: корпус, модули с прокачкой, оружие по подвескам.
    expect(loadoutShape(dst)).toEqual(loadoutShape(src))
    // Трюм: товар, количество, личная цена входа.
    expect(holdShape(dst)).toEqual(holdShape(src))

    // Состояние борта.
    expect(dst.player.hull).toBeCloseTo(src.player.hull)
    expect(dst.player.shield).toBeCloseTo(src.player.shield)
    expect(dst.player.energy).toBeCloseTo(src.player.energy)
    expect(dst.player.jumpCharge).toBeCloseTo(src.player.jumpCharge)
    expect(dst.player.auxEnergy).toBeCloseTo(src.player.auxEnergy)
    expect(dst.player.guns.map((g) => g.ammo)).toEqual(src.player.guns.map((g) => g.ammo))
  })

  it('спек выводится заново из каталога и учитывает прокачку и груз', () => {
    const src = playedWorld()
    const save = serializePlayer(src)
    const dst = createWorld(STARTER_SYSTEM)
    applyPlayerSave(dst, save)

    // Тяжёлые характеристики не хранятся — они выведены заново и обязаны совпасть
    // с исходными (та же сборка + тот же груз → тот же спек). Прокачанный щит даёт
    // тот же потолок, гружёный трюм — ту же массу.
    expect(dst.player.spec.hull.shield).toBeCloseTo(src.player.spec.hull.shield)
    expect(dst.player.spec.hull.hull).toBeCloseTo(src.player.spec.hull.hull)
    expect(dst.player.spec.cargoCapacity).toBe(src.player.spec.cargoCapacity)
    expect(dst.player.spec.mass).toBeCloseTo(src.player.spec.mass)
  })

  it('прокачка экземпляра не портит каталог (клон, а не запись в синглтон)', () => {
    const src = playedWorld()
    const upgraded = src.player.loadout.internals.find((m) => m.upgrade !== undefined)!
    // В сборке — 0.5, а в каталоге тот же модуль остался заводским.
    expect(upgraded.upgrade).toBe(0.5)
    expect(findModule(upgraded.id)?.upgrade).toBeUndefined()

    // И после round-trip каталог по-прежнему чист.
    applyPlayerSave(createWorld(STARTER_SYSTEM), serializePlayer(src))
    expect(findModule(upgraded.id)?.upgrade).toBeUndefined()
  })
})
