import { describe, expect, it } from 'vitest'
import { PULSE_LASER } from '../../config/modules'
import { createAIState } from '../ai/types'
import { rememberPilot } from './acquaintance'
import { applyContactPlan, compileRawPlan, contactEtaHops, rehydrateContactShip } from './plan'
import { createWorld, STARTER_SYSTEM } from './index'

describe('план знакомого', () => {
  it('компилирует «купи и прикрывай» в очередь + posture', () => {
    const world = createWorld({
      ...STARTER_SYSTEM,
      belt: null,
      patrols: [{ count: 1, at: [0, 0, -200], spread: 0, faction: 'neutral', name: 'X' }],
    })
    const ship = world.ships[0]!
    ship.ai = createAIState(ship.state.pos, world.rng)
    ship.ai.dock = 'berthed'

    const plan = compileRawPlan(
      [{ step: 'buy', module: PULSE_LASER.id }, { step: 'escort', cover: true }],
      world,
      ship,
      world.player.id,
    )

    expect(plan.posture).toBe('cover')
    expect(plan.queue.map((s) => s.kind)).toEqual(['buy', 'undock', 'join'])
  })

  it('rehydrate восстанавливает escort после спавна', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [{ count: 1, at: [0, 0, -200], spread: 0, faction: 'neutral', name: 'X' }] })
    const ship = world.ships[0]!
    rememberPilot(world, ship)
    const rec = world.acquaintances[0]!
    rec.plan = { queue: [], posture: 'cover', patronId: world.player.id }

    rehydrateContactShip(world, rec, ship)
    expect(ship.ai?.escortOf).toBe(world.player.id)
  })

  it('applyContactPlan отклоняет неизвестный модуль', () => {
    const world = createWorld(STARTER_SYSTEM)
    const ship = world.player
    rememberPilot(world, ship)
    const r = applyContactPlan(world, ship, [{ step: 'buy', module: 'нет-такого-лазера' }])
    expect(r.accepted).toBe(false)
  })

  it('contactEtaHops считает прыжки по дистанции и WANDER_RANGE', () => {
    expect(contactEtaHops(1, 1, 42)).toBe(0)
    const hops = contactEtaHops(0, 50, 42)
    expect(hops).toBeGreaterThanOrEqual(1)
  })
})
