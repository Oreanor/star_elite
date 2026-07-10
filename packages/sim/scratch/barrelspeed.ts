/**
 * Замер бочки: сколько длится и на сколько уводит вбок. Для глаз, не тест.
 *   npx tsx packages/sim/scratch/barrelspeed.ts
 */
import { Vector3 } from 'three'
import { PHYSICS } from '../src/config/physics'
import { MANOEUVRE } from '../src/config/manoeuvre'
import { stepWorld, type Controller } from '../src/domain/sim'
import { createWorld, STARTER_SYSTEM, type ShipEntity, type World } from '../src/domain/world'
import { beginManoeuvre, createManoeuvre, stepManoeuvre } from '../src/domain/flight/aerobatics'
import { forward } from '../src/domain/flight/axes'

function measure(speed: number): { seconds: number; offset: number; peakRoll: number } {
  const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
  const ship = world.player
  ship.state.pos.set(2e9, 0, 0)
  ship.state.quat.identity()
  ship.state.vel.set(0, 0, -speed)
  ship.controls.throttle = speed / ship.spec.tuning.MAX_SPEED

  const m = createManoeuvre()
  beginManoeuvre(m, 'barrel', 1)
  const start = ship.state.pos.clone().add(world.originOffset)
  const before = forward(ship.state.quat, new Vector3())

  const pilot: Controller = {
    update(s: ShipEntity, _w: World, dt: number) {
      s.controls.flightAssist = true
      s.controls.boost = 1
      s.controls.yaw = 0
      if (!stepManoeuvre(s, m, dt)) { s.controls.pitch = 0; s.controls.roll = 0 }
    },
    wantsFire: () => false,
  }
  const controllers = new Map([[ship.id, pilot]])
  const dt = PHYSICS.FIXED_DT
  let seconds = 0
  let peakRoll = 0
  while (m.kind !== null && seconds < MANOEUVRE.MAX_DURATION + 1) {
    stepWorld(world, dt, controllers)
    peakRoll = Math.max(peakRoll, Math.abs(ship.state.angVel.z))
    seconds += dt
  }
  const travel = ship.state.pos.clone().add(world.originOffset).sub(start)
  const advance = travel.dot(before)
  const offset = travel.clone().addScaledVector(before, -advance).length()
  return { seconds, offset, peakRoll }
}

for (const v of [60, 120, 180, 240]) {
  const r = measure(v)
  console.log(`скорость ${v} м/с:  бочка ${r.seconds.toFixed(2)} с,  сход ${r.offset.toFixed(1)} м,  пик крена ${r.peakRoll.toFixed(2)} рад/с`)
}
