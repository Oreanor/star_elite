import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { CRUISE } from '../../config/cruise'
import { PHYSICS } from '../../config/physics'
import { stepWorld } from '../sim/step'
import { createWorld, STARTER_SYSTEM, type BodyEntity, type World } from '../world'
import { bodyMass, gravityAccel, gravityReach, stepGravity } from './gravity'

const NO_CONTROLLERS = new Map()

function quiet(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

function bodyOf(world: World, kind: BodyEntity['kind']): BodyEntity {
  const body = world.bodies.find((b) => b.kind === kind)
  if (!body) throw new Error(`в мире нет тела «${kind}»`)
  return body
}

/** Над поверхностью тела, по радиусу от центра. */
function hover(world: World, body: BodyEntity, altitude: number): void {
  const player = world.player
  player.state.pos.copy(body.pos)
  player.state.pos.x += body.radius + player.spec.hull.radius + altitude
  player.state.vel.set(0, 0, 0)
  player.controls.throttle = 0
  player.controls.retro = 0
  player.controls.flightAssist = false
  player.cruise.factor = 1
}

describe('притяжение к телам', () => {
  it('масса планеты выводится из радиуса и плотности', () => {
    const world = quiet()
    const planet = bodyOf(world, 'planet')
    const mass = bodyMass(planet)
    expect(mass).toBeGreaterThan(1e22)
    expect(mass).toBeLessThan(1e25)
  })

  it('дальность зоны — полтора радиуса над поверхностью', () => {
    const world = quiet()
    const planet = bodyOf(world, 'planet')
    const reach = gravityReach(planet)
    expect(reach / planet.radius).toBeCloseTo(1.5, 5)
  })

  it('у звезды зона пропорциональна радиусу', () => {
    const world = quiet()
    const planet = bodyOf(world, 'planet')
    const star = bodyOf(world, 'star')
    expect(gravityReach(star) / gravityReach(planet)).toBeCloseTo(star.radius / planet.radius, 2)
  })

  it('на километре над планетой g почти как у поверхности', () => {
    const world = quiet()
    const planet = bodyOf(world, 'planet')
    hover(world, planet, 1_000)

    const g = gravityAccel(world.player, planet, new Vector3()).length()
    expect(g).toBeGreaterThan(8.5)
    expect(g).toBeLessThan(9.0)
  })

  it('на орбите станции (~500 км) g всё ещё ощутима', () => {
    const world = quiet()
    const planet = bodyOf(world, 'planet')
    hover(world, planet, 500_000)

    const g = gravityAccel(world.player, planet, new Vector3()).length()
    expect(g).toBeGreaterThan(7)
    expect(g).toBeLessThan(8.5)
  })

  it('за границей зоны g обнуляется', () => {
    const world = quiet()
    const planet = bodyOf(world, 'planet')
    hover(world, planet, gravityReach(planet) + 10_000)

    const g = gravityAccel(world.player, planet, new Vector3()).length()
    expect(g).toBeLessThan(1e-6)
  })

  it('на границе зоны g следует закону обратных квадратов', () => {
    const world = quiet()
    const planet = bodyOf(world, 'planet')
    hover(world, planet, gravityReach(planet) - 100)

    const gEdge = gravityAccel(world.player, planet, new Vector3()).length()
    hover(world, planet, 100)
    const gSurf = gravityAccel(world.player, planet, new Vector3()).length()
    expect(gEdge / gSurf).toBeCloseTo(1 / 2.5 ** 2, 1)
  })

  it('у станции не падает, пока не спустился ниже половины её орбиты', () => {
    const world = quiet()
    const station = bodyOf(world, 'station')
    if (!station.orbit?.parentId) throw new Error('станция не обращается вокруг планеты')
    const planet = world.bodies.find((b) => b.id === station.orbit!.parentId)
    if (!planet) throw new Error('нет планеты станции')

    world.player.state.pos.copy(station.pos)
    world.player.state.vel.set(0, 0, 0)
    world.player.controls.flightAssist = false
    stepGravity(world.player, world, PHYSICS.FIXED_DT)
    expect(world.player.state.vel.length()).toBeLessThan(1e-9)

    const halfAltitude = (station.orbit.radius - planet.radius) * 0.5
    hover(world, planet, halfAltitude - 1_000)
    stepGravity(world.player, world, PHYSICS.FIXED_DT)
    expect(world.player.state.vel.length()).toBeGreaterThan(0)
  })

  it('между планетами g нулевая', () => {
    const world = quiet()
    const planet = bodyOf(world, 'planet')
    hover(world, planet, 75_000_000_000)

    const g = gravityAccel(world.player, planet, new Vector3()).length()
    expect(g).toBeLessThan(1e-6)
  })

  it('без тяги корабль падает на планету и гибнет', () => {
    const world = quiet()
    const planet = bodyOf(world, 'planet')
    hover(world, planet, 600)

    for (let i = 0; i < 1500; i++) {
      stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
      if (!world.player.alive) break
    }

    expect(world.player.alive).toBe(false)
  })

  it('на крейсерском ходу вне фазы гравитация не действует', () => {
    const world = quiet()
    const planet = bodyOf(world, 'planet')
    hover(world, planet, 400)
    world.player.cruise.factor = CRUISE.PHASE_THRESHOLD + 1

    const before = world.player.state.vel.lengthSq()
    stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
    expect(world.player.state.vel.lengthSq()).toBe(before)
  })
})
