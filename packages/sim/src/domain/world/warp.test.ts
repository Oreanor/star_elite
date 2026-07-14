import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { pirateLeaderLoadout, pirateLoadout, traderLoadout } from '../../config/loadouts'
import { WARP } from '../../config/ai'
import { aiController } from '../ai/pilot'
import { createAIState } from '../ai/types'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { makeShip } from './factory'
import { beginWarpArrival, beginWarpDeparture, jumpOut, stepWarpEmergence } from './warp'

/**
 * Побег из системы прыжком. Проверяем свойства, а не тайминги: уход — не гибель
 * (без взрыва и награды), уйти может только тот, кому есть на чём (привод), и
 * напуганный с приводом рано или поздно уходит — но это редкость, а не мгновенность.
 */

function emptyWorld(): World {
  return createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
}

describe('гиперпрыжок-побег', () => {
  it('уход прыжком — не гибель: без взрыва, трофеев и награды', () => {
    const world = emptyWorld()
    const creditsBefore = world.credits
    const ship = makeShip(world.ids, 'hostile', 'Пират', pirateLoadout(), new Vector3(0, 0, -400), new Quaternion())
    world.ships.push(ship)

    jumpOut(world, ship)

    expect(ship.warpedOut).toBe(true)
    // Вспышка ВЫХОДА на его месте, а не взрыв.
    expect(world.warps).toHaveLength(1)
    expect(world.warps[0]!.arriving).toBe(false)
    expect(world.explosions).toHaveLength(0)
    // Сбежавший не приносит награды: это не сбитый.
    expect(world.credits).toBe(creditsBefore)
  })

  it('без привода не уходит прыжком, сколько ни пугай', () => {
    const world = emptyWorld()
    const pirate = makeShip(world.ids, 'hostile', 'Пират', pirateLoadout(), new Vector3(0, 0, -500), new Quaternion(), world.rng)
    pirate.ai = createAIState(new Vector3(0, 0, -500), world.rng)
    // У рядового пирата привода нет — уходить не на чем.
    expect(pirate.spec.jumpRange).toBe(0)
    world.ships.push(pirate)

    for (let i = 0; i < 500; i++) {
      pirate.ai!.thinkTimer = 0
      pirate.ai!.mode = 'evade'
      pirate.lastHitAt = world.time
      aiController.update(pirate, world, 0.1)
    }

    expect(pirate.warpedOut).toBe(false)
    expect(pirate.ai!.warpTimer).toBeLessThan(0)
  })

  it('напуганный главарь с приводом рано или поздно уходит через портал', () => {
    const world = emptyWorld()
    const raider = makeShip(world.ids, 'hostile', 'Налётчик', pirateLeaderLoadout(), new Vector3(0, 0, -500), new Quaternion(), world.rng)
    raider.ai = createAIState(new Vector3(0, 0, -500), world.rng)
    // У главаря компактный привод стоит именно ради побега.
    expect(raider.spec.jumpRange).toBeGreaterThan(0)
    world.ships.push(raider)

    let jumped = false
    for (let i = 0; i < 3000 && !jumped; i++) {
      raider.ai!.thinkTimer = 0
      raider.ai!.mode = 'evade' // держим напуганным
      raider.lastHitAt = world.time
      aiController.update(raider, world, 0.1)
      stepWarpEmergence(world, 0.1)
      if (raider.warpDeparting) {
        raider.state.pos.addScaledVector(raider.state.vel, 0.1)
      }
      world.time += 0.1
      if (raider.warpedOut) jumped = true
    }

    expect(jumped).toBe(true)
    expect(raider.warpDeparting).toBe(false)
    expect(world.warpPortals).toHaveLength(0)
  })
})

describe('гиперпортал прибытия', () => {
  it('портал ставит борт за дырой и гасит ход', () => {
    const world = emptyWorld()
    const ship = makeShip(world.ids, 'neutral', 'Тест', traderLoadout(), new Vector3(0, 0, -5000), new Quaternion(), world.rng)
    ship.ai = createAIState(new Vector3(0, 0, 0), world.rng)
    world.ships.push(ship)
    beginWarpArrival(world, ship, ship.state.pos, new Vector3(0, 0, 1))
    expect(world.warpPortals).toHaveLength(1)
    expect(world.warpPortals[0]!.kind).toBe('arrive')
    expect(ship.warpEmerging).toBe(true)
    expect(ship.state.vel.length()).toBeGreaterThan(100)
    stepWarpEmergence(world, 0.5)
    expect(ship.state.vel.length()).toBeLessThan(WARP.ARRIVAL.EMERGE_SPEED)
  })
})

describe('гиперпортал ухода', () => {
  it('разгоняет борт в кольцо и помечает warpedOut после прохода', () => {
    const world = emptyWorld()
    const ship = makeShip(world.ids, 'neutral', 'Тест', traderLoadout(), new Vector3(0, 0, -500), new Quaternion(), world.rng)
    ship.state.quat.setFromAxisAngle(new Vector3(0, 1, 0), 0)
    world.ships.push(ship)

    beginWarpDeparture(world, ship)
    expect(world.warpPortals).toHaveLength(1)
    expect(world.warpPortals[0]!.kind).toBe('depart')
    expect(ship.warpDeparting).toBe(true)
    expect(ship.state.vel.length()).toBeLessThan(1)

    for (let i = 0; i < 80 && !ship.warpedOut; i++) {
      stepWarpEmergence(world, 0.05)
      ship.state.pos.addScaledVector(ship.state.vel, 0.05)
      world.time += 0.05
    }

    expect(ship.warpedOut).toBe(true)
    expect(world.warpPortals).toHaveLength(0)
    expect(world.warps).toHaveLength(0)
  })
})
