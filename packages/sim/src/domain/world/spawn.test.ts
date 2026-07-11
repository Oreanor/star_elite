import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createWorld, startAtStation, STARTER_SYSTEM } from '../world'

/**
 * Старт новой игры. Гиперпрыжок выводит за тысячу километров от причала — это
 * правильно для перелёта, но НЕ для первого кадра игры. `startAtStation` обязан
 * поставить игрока вплотную, и именно после того, как расталкивание тел уже
 * отработало: три предыдущих правки ломались как раз на том, что игрока сперва
 * ставили рядом, а `enterSystem` тут же отшвыривал его на STANDOFF.
 */
describe('старт вплотную к станции', () => {
  it('игрок оказывается в паре километров от причала, а не за тысячу', () => {
    const world = createWorld()
    const station = world.bodies.find((b) => b.kind === 'station')!

    startAtStation(world, 2_500)

    const dist = world.player.state.pos.distanceTo(station.pos)
    // Ровно вынос: радиус причала + зазор. Никакого STANDOFF в километр.
    expect(dist).toBeCloseTo(station.radius + 2_500, 0)
    expect(dist).toBeLessThan(5_000)
  })

  it('нос смотрит на причал: станция сразу в кадре', () => {
    const world = createWorld()
    const station = world.bodies.find((b) => b.kind === 'station')!

    startAtStation(world)

    // Направление носа (−Z в связанных осях) должно указывать на станцию.
    const toStation = station.pos.clone().sub(world.player.state.pos).normalize()
    const forward = new Vector3(0, 0, -1).applyQuaternion(world.player.state.quat)
    expect(forward.dot(toStation)).toBeGreaterThan(0.99)
  })

  it('без станции в системе тихо ничего не делает', () => {
    const world = createWorld({ ...STARTER_SYSTEM, station: null })
    const before = world.player.state.pos.clone()

    startAtStation(world)

    expect(world.player.state.pos.distanceTo(before)).toBe(0)
  })
})
