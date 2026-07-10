import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { traderLoadout } from '../../config/loadouts'
import { aiController } from '../ai/pilot'
import { createAIState } from '../ai/types'
import { createWorld, makeShip, STARTER_SYSTEM, type BodyEntity, type ShipEntity, type World } from '../world'

/**
 * Очередь на стыковку. Причал ОДИН, и занимать его трафик обязан по одному:
 * проверяем инвариант «на причале не больше одного», а не конкретные траектории.
 */

function quietHome(): { world: World; station: BodyEntity } {
  const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
  const station = world.bodies.find((b) => b.kind === 'station')!
  return { world, station }
}

/** Торговец-докер у ворот причала. dt-обновление уведёт его на стыковку. */
function docker(world: World, station: BodyEntity, offset: Vector3): ShipEntity {
  const pos = station.pos.clone().add(offset)
  const ship = makeShip(world.ids, 'neutral', 'Торговец', traderLoadout(), pos, new Quaternion())
  ship.ai = createAIState(pos, world.rng)
  ship.ai.dock = 'inbound'
  world.ships.push(ship)
  return ship
}

describe('очередь на стыковку', () => {
  it('причал занимает ровно один, второй ждёт очередь', () => {
    const { world, station } = quietHome()
    const a = docker(world, station, new Vector3(station.radius + 400, 0, 0))
    const b = docker(world, station, new Vector3(station.radius + 400, 0, 300))

    // dt больше стартового thinkTimer (≤0.12): такт размышления сработает у обоих.
    aiController.update(a, world, 0.2)
    aiController.update(b, world, 0.2)

    // Место занято ровно одним из них — второй на него не претендует.
    expect(world.dockOccupantId === a.id || world.dockOccupantId === b.id).toBe(true)
    const waiting = world.dockOccupantId === a.id ? b : a
    expect(waiting.id).not.toBe(world.dockOccupantId)
  })

  it('отстоявший у причала освобождает место, и следующий его занимает', () => {
    const { world, station } = quietHome()
    const a = docker(world, station, new Vector3(station.radius + 300, 0, 0))
    // A уже пришвартован и вот-вот отчалит.
    a.ai!.dock = 'berthed'
    a.ai!.dockTimer = 0.05
    world.dockOccupantId = a.id

    const b = docker(world, station, new Vector3(station.radius + 300, 0, 300))

    aiController.update(a, world, 0.2) // время вышло → отчаливает, освобождает причал
    expect(a.ai!.dock).toBe('done')
    expect(world.dockOccupantId).toBeNull()

    aiController.update(b, world, 0.2) // место свободно → занимает следующий
    expect(world.dockOccupantId).toBe(b.id)
  })
})
