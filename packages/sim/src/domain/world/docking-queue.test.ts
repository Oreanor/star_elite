import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { traderLoadout } from '../../config/loadouts'
import { aiController } from '../ai/pilot'
import { createAIState } from '../ai/types'
import { createWorld, makeShip, STARTER_SYSTEM, type BodyEntity, type ShipEntity, type World } from '../world'
import { berthOccupant, claimBerth } from '../station/berth'

/**
 * Очередь на стыковку. Причал у станции один, и занимать его трафик обязан по одному:
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
    const occupant = berthOccupant(world, station.id)
    expect(occupant === a.id || occupant === b.id).toBe(true)
    const waiting = occupant === a.id ? b : a
    expect(waiting.id).not.toBe(occupant)
  })

  it('отстоявший у причала освобождает место, и следующий его занимает', () => {
    const { world, station } = quietHome()
    const a = docker(world, station, new Vector3(station.radius + 300, 0, 0))
    // A уже пришвартован и вот-вот отчалит.
    a.ai!.dock = 'berthed'
    a.ai!.dockTimer = 0.05
    claimBerth(world, station.id, a.id)

    const b = docker(world, station, new Vector3(station.radius + 300, 0, 300))

    aiController.update(a, world, 0.2) // время вышло → отчаливает, освобождает причал
    expect(a.ai!.dock).toBe('done')
    expect(berthOccupant(world, station.id)).toBeNull()

    aiController.update(b, world, 0.2) // место свободно → занимает следующий
    expect(berthOccupant(world, station.id)).toBe(b.id)
  })

  it('заходящий бот держит свою станцию, когда игрок улетел к другой', () => {
    // Пойманная дыра: станцию стыковки бот брал заново каждый такт как ближайшую к ИГРОКУ —
    // игрок улетел к другому причалу, и весь заходящий трафик разворачивался через систему.
    const { world, station } = quietHome()
    const other: BodyEntity = { ...station, id: world.ids.next(), name: 'Другая', pos: station.pos.clone().add(new Vector3(5e7, 0, 0)) }
    world.bodies.push(other)
    world.player.state.pos.copy(station.pos).add(new Vector3(station.radius + 2_000, 0, 0))
    const a = docker(world, station, new Vector3(station.radius + 400, 0, 0))
    aiController.update(a, world, 0.2)
    expect(a.ai!.dockStationId).toBe(station.id)
    world.player.state.pos.copy(other.pos).add(new Vector3(other.radius + 2_000, 0, 0))
    aiController.update(a, world, 0.2)
    expect(a.ai!.dockStationId).toBe(station.id)
    // Чужой причал свободен: занятость — по станции, а не одна на систему.
    expect(berthOccupant(world, other.id)).toBeNull()
  })
})
