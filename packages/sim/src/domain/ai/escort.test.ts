import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { pirateLoadout } from '../../config/loadouts'
import { stepWorld } from '../sim'
import type { Controller } from '../sim/controller'
import { createWorld, STARTER_SYSTEM } from '../world'
import { makeShip } from '../world/factory'
import { aiController } from './pilot'
import { createAIState } from './types'

/** Игрок висит на месте: ждёт отставшего эскорта. */
const idle: Controller = {
  update(ship) {
    ship.controls.throttle = 0
  },
  wantsFire: () => false,
}

describe('эскорт догоняет нанимателя', () => {
  // Пойманный баг: вылетели со станции врозь, эскорт в 8 км «патрулировал» к игроку на
  // трети газа и полз минутами. Отставший ведомый обязан догнать, а не кружить.
  it('из 8 км подходит к стоящему игроку быстрее, чем на патрульном ходу', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    world.ships.length = 0
    const player = world.player
    const start = new Vector3(8_000, 0, 0).add(player.state.pos)
    const escort = makeShip(world.ids, 'police', 'Эскорт', pirateLoadout(), start, new Quaternion(), world.rng)
    escort.ai = createAIState(start, world.rng)
    escort.ai.escortOf = player.id
    world.ships.push(escort)

    // Патрульный ход — треть газа: столько шёл бы на 8 км прежний эскорт.
    const patrolTime = 8_000 / (escort.spec.tuning.MAX_SPEED * 0.35)
    const controllers = new Map([[player.id, idle]])
    let t = 0
    while (t < patrolTime / 3 && escort.state.pos.distanceTo(player.state.pos) > 1_000) {
      stepWorld(world, 1 / 60, controllers, { unassigned: aiController })
      t += 1 / 60
    }
    expect(escort.state.pos.distanceTo(player.state.pos)).toBeLessThan(1_000)
    // И не пролетел насквозь на крейсере: у нанимателя он уже на обычном ходу.
    expect(escort.cruise.factor).toBeLessThan(2)
  })
})
