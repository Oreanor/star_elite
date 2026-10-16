import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { auroraVeteranLoadout, pirateLoadout } from '../../config/loadouts'
import { GUNNERY } from '../../config/weapons'
import { quietWorld } from '../../testkit'
import { refreshSpec } from '../world/factory'
import { aimSpeed } from './dogfight'
import { avoidBodies } from './maneuvers'

/**
 * Пойманные баги автобоя у станции: обход тел срабатывал на ЧИСТЫХ отрезках (мерили до
 * бесконечной прямой, а запас ужимали почти до корабля), и луч целился в точку упреждения болта.
 */
describe('наведение в бою', () => {
  it('короткий отрезок у станции, не режущий её, обхода не вызывает', () => {
    const world = quietWorld()
    const station = world.bodies.find((b) => b.kind === 'station')!
    const r = station.radius
    // Оба у станции на одной высоте, в 150 м друг от друга: станции между ними нет.
    const pos = station.pos.clone().add(new Vector3(r * 1.16, 0, 0))
    const aim = station.pos.clone().add(new Vector3(r * 1.157, 0, 150))
    const out = new Vector3()
    avoidBodies(pos, aim, world.bodies, out)
    expect(out.distanceTo(aim)).toBeLessThan(1e-6)
  })

  it('отрезок СКВОЗЬ станцию — обходится', () => {
    const world = quietWorld()
    const station = world.bodies.find((b) => b.kind === 'station')!
    const r = station.radius
    const pos = station.pos.clone().add(new Vector3(-r * 2, 0, 0))
    const aim = station.pos.clone().add(new Vector3(r * 2, 0, 0))
    const out = new Vector3()
    avoidBodies(pos, aim, world.bodies, out)
    expect(out.distanceTo(aim)).toBeGreaterThan(r)
  })

  it('лучевая установка целится в саму цель, болтовая — с упреждением', () => {
    const world = quietWorld()
    const p = world.player
    p.loadout = auroraVeteranLoadout()
    refreshSpec(p)
    expect(aimSpeed(p)).toBeGreaterThan(GUNNERY.BOLT_SPEED * 100)
    p.loadout = pirateLoadout()
    refreshSpec(p)
    expect(aimSpeed(p)).toBe(GUNNERY.BOLT_SPEED)
  })
})
