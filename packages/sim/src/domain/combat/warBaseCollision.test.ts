import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { meshSolidRadius } from '../flight/landing'
import { stepWorld } from '../sim/step'
import { createWorld, STARTER_SYSTEM } from '../world'

/** Мир с одной военной базой у причала. */
function withBase() {
  return createWorld({
    ...STARTER_SYSTEM,
    warBases: [{ name: 'База', radius: 1_000, stationOffset: [8_000, 0, 0], model: 0 }],
  })
}

const NO_CONTROLLERS = new Map()

/**
 * Корпус базы твёрдый, но не смертельный: отскок без урона (жёлтый «КРУШЕНИЕ»).
 */
describe('столкновение с военной базой', () => {
  it('корабль внутри базы отскакивает живым', () => {
    const world = withBase()
    const rock = world.warBases[0]
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
