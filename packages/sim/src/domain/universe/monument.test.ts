import { describe, expect, it } from 'vitest'
import { TIME } from '../../config/time'
import { createWorld, spawnSlovo } from '../world/factory'
import { slovoAtHome } from '../world/slovo'
import { stepGalaxyPresence } from '../galaxy/presence'
import { stepWorld } from '../sim/step'
import { MONUMENT_SYSTEM } from './monument'

/**
 * КРЕСТЫ — комната вне галактик. Инварианты: там дом Слова и дверь назад, на месте выхода не
 * жжёт и не тянет Люцифер, а галактика не пытается пересобрать комнату в ближайшую звезду.
 */

const DAY = 86_400 / TIME.SCALE

describe('комната-монумент Кресты', () => {
  it('крест-станция, Дверь назад, и Слово на кресте — когда по расписанию дома', () => {
    const world = createWorld(MONUMENT_SYSTEM)
    expect(world.inMonument).toBe(true)
    expect(world.bodies.some((b) => b.kind === 'station' && b.stationStyle === 'cross')).toBe(true)
    expect(world.bodies.some((b) => b.kind === 'blackhole')).toBe(true)

    let t = 0
    while (!slovoAtHome(world.galaxySeed, t)) t += DAY
    world.calendarTime = t
    world.ships = world.ships.filter((s) => !s.divine)
    spawnSlovo(world)
    expect(world.ships.some((s) => s.divine && s.kinematic)).toBe(true)
  })

  it('на месте выхода не жжёт и не тянет: Люцифер лишь светит', () => {
    const world = createWorld(MONUMENT_SYSTEM)
    world.docked = false
    world.player.state.vel.set(0, 0, 0)
    world.player.controls.throttle = 0
    for (let i = 0; i < 10 * 60; i++) stepWorld(world, 1 / 60, new Map())
    expect(world.player.alive).toBe(true)
    expect(world.player.hullHeat).toBeLessThan(0.01)
    expect(world.player.state.vel.length()).toBeLessThan(1)
  })

  it('галактика комнату не пересобирает, сколько ни летай', () => {
    const world = createWorld(MONUMENT_SYSTEM)
    world.docked = false
    const epoch = world.epoch
    world.player.state.pos.x += 1e12
    stepGalaxyPresence(world, 1)
    expect(world.epoch).toBe(epoch)
    expect(world.inMonument).toBe(true)
  })
})
