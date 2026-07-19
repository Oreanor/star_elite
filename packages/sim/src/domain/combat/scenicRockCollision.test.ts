import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { meshSolidRadius } from '../flight/landing'
import { stepWorld } from '../sim/step'
import { createWorld } from '../world'

const NO_CONTROLLERS = new Map()

/**
 * Глыбы двора твёрдые, но не смертельные: отскок без урона (жёлтый «КРУШЕНИЕ»).
 */
describe('столкновение с глыбой двора', () => {
  it('корабль внутри глыбы отскакивает живым', () => {
    const world = createWorld()
    const rock = world.scenicRocks[0]
    expect(rock).toBeDefined()

    const player = world.player
    const before = player.hull + player.shield
    player.state.pos.copy(rock!.pos)
    player.state.vel.set(80, 0, 0)
    player.cruise.factor = 1
    player.shield = player.spec.hull.shield

    stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)

    expect(player.alive).toBe(true)
    expect(player.hull + player.shield).toBe(before)
    expect(player.state.pos.distanceTo(rock!.pos)).toBeGreaterThanOrEqual(meshSolidRadius(rock!.radius))
    expect(player.lastCrashAt).toBe(world.time)
  })
})
