import { Quaternion, Vector3 } from 'three'
import { pirateLoadout } from '../../config/loadouts'
import { createAIState } from '../ai/types'
import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { STARTER_SYSTEM, createWorld, makeShip } from '.'
import { systemDefFor } from '../galaxy/jump'
import { SHARED_START_INDEX } from '../galaxy/sharedStart'
import { COMMODITIES } from '../cargo/items'
import { orbitTime, stepOrbits } from './orbits'
import { maybeShiftOrigin } from './origin'
import { placeFigurineFromHold, tryScoopFigurine } from './figurines'

/**
 * Системы отсчёта. Правило одно: каждый объект едет с телом, к которому привязан; окрестность
 * игрока — с его опорой. Пойманные расхождения — по тесту на каждое.
 */
function startWorld() {
  const world = createWorld({ ...systemDefFor(SHARED_START_INDEX, GALAXY.SEED), belt: null })
  const station = world.bodies.find((b) => b.kind === 'station')!
  world.player.state.pos.copy(station.pos).add(new Vector3(0, 0, station.radius * 3))
  const pos = world.player.state.pos.clone().add(new Vector3(500, 0, 0))
  const ship = makeShip(world.ids, 'neutral', 'Торговец', pirateLoadout(), pos, new Quaternion(), world.rng)
  ship.ai = createAIState(pos, world.rng)
  world.ships.push(ship)
  return { world, station }
}

describe('системы отсчёта', () => {
  it('пилот бота едет вместе с бортом: его точки не уплывают при переносе опорой', () => {
    // Пойманный баг: орбитальный перенос двигал корабли, но не память их пилотов — точка
    // патруля и дом уплывали на десятки км/с, и бот гнался за пустым местом.
    const { world } = startWorld()
    const ship = world.ships.find((s) => s.ai && !s.divine && s.pilotName !== undefined)
    expect(ship).toBeDefined()
    const ai = ship!.ai!
    ship!.state.pos.copy(world.player.state.pos).add(new Vector3(500, 0, 0))
    ai.waypoint.copy(ship!.state.pos).add(new Vector3(0, 0, 2000))
    const rel = ai.waypoint.clone().sub(ship!.state.pos)

    stepOrbits(world, orbitTime(world) + 60)

    expect(ai.waypoint.clone().sub(ship!.state.pos).distanceTo(rel)).toBeLessThan(1e-3)
  })

  it('сидишь на военной базе — едешь с причалом, а не с соседним телом', () => {
    const { world, station } = startWorld()
    const base = world.warBases[0]
    if (!base) return
    world.player.state.pos.copy(base.pos).add(new Vector3(0, base.radius * 1.1, 0))
    world.player.landedOn = { bodyId: base.id, normal: new Vector3(0, 1, 0), altitude: 10 }
    const rel = world.player.state.pos.clone().sub(base.pos)
    const stationBefore = station.pos.clone()

    stepOrbits(world, orbitTime(world) + 60)

    expect(station.pos.distanceTo(stationBefore)).toBeGreaterThan(10)
    expect(world.player.state.pos.clone().sub(base.pos).distanceTo(rel)).toBeLessThan(1e-3)
  })

  it('статуэтка, поставленная из трюма, не уплывает от пилота орбитой', () => {
    // Пойманный баг: поставленная статуэтка висела в системе звезды, а пилот ехал с ближайшим
    // телом — она уносилась с орбитальной скоростью прямо из-под носа.
    const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    const fig = world.figurines[0]!
    const ship = world.player
    ship.state.scale = (fig.radius * 2) / ship.spec.hull.radius
    ship.state.pos.copy(fig.pos)
    expect(tryScoopFigurine(ship, fig)).toBe(true)
    const index = ship.hold.items.findIndex((i) => i.kind === 'commodity' && i.commodity.id === COMMODITIES.FIGURINE.id)
    expect(placeFigurineFromHold(world, ship, index)).toBe('ok')
    const placed = world.figurines[world.figurines.length - 1]!
    expect(placed.anchorId).toBeDefined()
    const rel = placed.pos.clone().sub(ship.state.pos)

    stepOrbits(world, orbitTime(world) + 600)

    expect(placed.pos.clone().sub(ship.state.pos).distanceTo(rel)).toBeLessThan(1)
  })

  it('перецентровка начала двигает всё одним сдвигом: взаимные места не меняются', () => {
    const { world, station } = startWorld()
    world.player.state.pos.add(new Vector3(9000, 0, 0))
    const ship = world.ships[0]!
    const shipRel = ship.state.pos.clone().sub(world.player.state.pos)
    const stationRel = station.pos.clone().sub(world.player.state.pos)
    maybeShiftOrigin(world)
    expect(world.player.state.pos.length()).toBeLessThan(1e-6)
    expect(ship.state.pos.clone().sub(world.player.state.pos).distanceTo(shipRel)).toBeLessThan(1e-6)
    expect(station.pos.clone().sub(world.player.state.pos).distanceTo(stationRel)).toBeLessThan(1e-6)
  })
})
