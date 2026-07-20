import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { meshSolidRadius } from '../flight/landing'
import { stepWorld } from '../sim/step'
import { createWorld, enterSystem, STARTER_SYSTEM } from '../world'

/**
 * Мир в системе, где лежит двор глыб Люцифера. Число статуй — бросок 0..COUNT_MAX по сиду
 * системы, ноль законен, поэтому подходящую систему ищем перебором в ОДНОМ мире.
 */
function withYard() {
  const world = createWorld()
  for (let i = 0; i < 200; i++) {
    enterSystem(world, STARTER_SYSTEM, i)
    if (world.monoliths.some((m) => m.variant === 0)) return world
  }
  throw new Error('не нашлось системы с двором Люцифера')
}

const NO_CONTROLLERS = new Map()

/**
 * Глыбы двора твёрдые, но не смертельные: отскок без урона (жёлтый «КРУШЕНИЕ»).
 */
describe('столкновение с глыбой двора', () => {
  it('корабль внутри глыбы отскакивает живым', () => {
    const world = withYard()
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
