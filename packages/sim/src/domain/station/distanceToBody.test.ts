import { describe, expect, it } from 'vitest'
import { createWorld } from '../world'
import { distanceToBody, findStation, startDocked } from './docking'

/**
 * Расстояние до тела у всех приборов одно: до поверхности, а у своей станции у причала — ноль.
 * Пойманное: у причала карта писала «1.1 км» до собственной станции — меряла до центра.
 */
describe('расстояние до тела', () => {
  it('у причала до своей станции — ноль', () => {
    const world = createWorld()
    startDocked(world)
    const station = findStation(world)!
    expect(world.docked).toBe(true)
    expect(distanceToBody(world, station)).toBe(0)
  })

  it('в полёте — до поверхности, не до центра', () => {
    const world = createWorld()
    const planet = world.bodies.find((b) => b.kind === 'planet')!
    const centre = planet.pos.distanceTo(world.player.state.pos)
    expect(distanceToBody(world, planet)).toBeCloseTo(centre - planet.radius, 3)
  })
})
