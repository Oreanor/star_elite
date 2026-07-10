/**
 * Замер всех трёх фигур: длительность, сход, доворот курса. Для глаз, не тест.
 *   npx tsx packages/sim/scratch/figspeed.ts
 */
import { Vector3 } from 'three'
import { PHYSICS } from '../src/config/physics'
import { MANOEUVRE } from '../src/config/manoeuvre'
import { stepWorld, type Controller } from '../src/domain/sim'
import { createWorld, STARTER_SYSTEM, type ShipEntity, type World } from '../src/domain/world'
import { beginManoeuvre, createManoeuvre, stepManoeuvre, type ManoeuvreKind } from '../src/domain/flight/aerobatics'
import { forward } from '../src/domain/flight/axes'

function measure(kind: ManoeuvreKind, speed = 180) {
  const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
  const ship = world.player
  ship.state.pos.set(2e9, 0, 0)
  ship.state.quat.identity()
  ship.state.vel.set(0, 0, -speed)
  ship.state.angVel.set(0, 0, 0)
  ship.controls.throttle = speed / ship.spec.tuning.MAX_SPEED

  const m = createManoeuvre()
  beginManoeuvre(m, kind, 1)
  const start = ship.state.pos.clone().add(world.originOffset)
  const before = forward(ship.state.quat, new Vector3())

  const pilot: Controller = {
    update(s: ShipEntity, _w: World, dt: number) {
      s.controls.flightAssist = true
      s.controls.boost = 1
      s.controls.retro = 0
      s.controls.yaw = 0
      if (!stepManoeuvre(s, m, dt)) { s.controls.pitch = 0; s.controls.roll = 0 }
    },
    wantsFire: () => false,
  }
  const controllers = new Map([[ship.id, pilot]])
  const dt = PHYSICS.FIXED_DT
  let seconds = 0
  let peak = 0
  while (m.kind !== null && seconds < MANOEUVRE.MAX_DURATION + 1) {
    stepWorld(world, dt, controllers)
    peak = Math.max(peak, ship.state.angVel.length())
    seconds += dt
  }
  const travel = ship.state.pos.clone().add(world.originOffset).sub(start)
  const advance = travel.dot(before)
  const offset = travel.clone().addScaledVector(before, -advance).length()
  const after = forward(ship.state.quat, new Vector3())
  return { seconds, advance, offset, dot: before.dot(after), peak }
}

for (const kind of ['barrel', 'loop', 'reversal'] as const) {
  const r = measure(kind)
  console.log(
    `${kind.padEnd(9)} ${r.seconds.toFixed(2)} с  сход ${r.offset.toFixed(0).padStart(4)} м  ` +
    `вперёд ${r.advance.toFixed(0).padStart(4)} м  курс·курс ${r.dot.toFixed(3)}  пик ${r.peak.toFixed(2)} рад/с`,
  )
}
