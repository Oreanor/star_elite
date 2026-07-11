import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { pirateLeaderLoadout, pirateLoadout } from '../../config/loadouts'
import { aiController } from '../ai/pilot'
import { createAIState } from '../ai/types'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { makeShip } from './factory'
import { jumpOut } from './warp'

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

  it('напуганный главарь с приводом рано или поздно уходит прыжком', () => {
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
      aiController.update(raider, world, 0.1)
      if (raider.warpedOut) jumped = true
    }

    expect(jumped).toBe(true)
    // Ушёл — на его месте вспышка выхода.
    expect(world.warps.some((w) => !w.arriving)).toBe(true)
  })
})
