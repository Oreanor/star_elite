import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { effectiveRadius } from '../scale/scale'
import { stepWorld } from '../sim/step'
import { createWorld, STARTER_SYSTEM, type BodyEntity, type World } from '../world'

const NO_CONTROLLERS = new Map()

function quiet(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

function moonOf(world: World): BodyEntity {
  const moon = world.bodies.find((body) => body.kind === 'moon')
  if (!moon) throw new Error('в системе нет луны')
  return moon
}

function touch(world: World, body: BodyEntity): void {
  const player = world.player
  player.state.pos.copy(body.pos).add(new Vector3(body.radius + effectiveRadius(player) - 1, 0, 0))
  player.state.vel.set(-1000, 0, 0)
  player.controls.throttle = 0
  player.controls.flightAssist = false
}

describe('посадка на поверхность', () => {
  it('луна принимает корабль так же, как планета', () => {
    const world = quiet()
    const moon = moonOf(world)
    touch(world, moon)

    stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)

    expect(world.player.alive).toBe(true)
    expect(world.player.landedOn?.bodyId).toBe(moon.id)
  })

  it('посаженный корабль следует за луной на её реальной орбите', () => {
    const world = quiet()
    const moon = moonOf(world)
    touch(world, moon)
    stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
    const parent = world.bodies.find((body) => body.id === moon.orbit?.parentId)!
    const before = moon.pos.clone().sub(parent.pos)

    world.calendarTime += 10_000
    stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)

    expect(moon.pos.clone().sub(parent.pos).distanceTo(before)).toBeGreaterThan(1000)
    expect(world.player.state.pos.distanceTo(moon.pos)).toBeCloseTo(
      moon.radius + effectiveRadius(world.player),
      3,
    )
  })

  it('после взлёта ближайшее тело не убегает с орбитальной скоростью', () => {
    const world = quiet()
    const moon = moonOf(world)
    touch(world, moon)
    stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)

    world.player.controls.throttle = 0.2
    stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
    world.player.controls.throttle = 0

    for (let i = 0; i < 120; i++) {
      world.calendarTime += PHYSICS.FIXED_DT
      stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)
    }

    const altitude = world.player.state.pos.distanceTo(moon.pos)
      - moon.radius - effectiveRadius(world.player)
    expect(world.player.landedOn).toBeNull()
    expect(altitude).toBeGreaterThan(0)
    expect(altitude).toBeLessThan(1000)
  })
})
