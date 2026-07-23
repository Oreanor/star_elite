import { Vector3 } from 'three'
import { GRAVITY } from '../src/config'
import { createWorld, STARTER_SYSTEM } from '../src/domain/world'
import { stepWorld } from '../src/domain/sim/step'

const w = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
const moons = w.bodies.filter((b) => b.kind === 'moon').sort((a, b) => b.radius - a.radius)
const planets = w.bodies.filter((b) => b.kind === 'planet').sort((a, b) => b.radius - a.radius)
const km = (m: number) => (m / 1000).toFixed(1)

for (const body of [...moons.slice(0, 2), ...planets.slice(0, 1)]) {
  const mass = GRAVITY.ROCK_DENSITY * (4 / 3) * Math.PI * body.radius ** 3
  const g = (GRAVITY.G * mass) / body.radius ** 2
  console.log(`${body.kind} «${body.name}» R=${km(body.radius)} км, g≈${g.toFixed(2)} м/с² (${(g / 9.81).toFixed(2)} земных)`)
}

const m = moons[0]!
const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
const mm = world.bodies.filter((b) => b.kind === 'moon').sort((a, b) => b.radius - a.radius)[0]!
world.player.state.pos.copy(mm.pos).add(new Vector3(0, mm.radius + 500, 0))
world.player.state.vel.set(0, 0, 0)
world.player.lastCrashAt = -1
console.log(`\nвисим в 500 м над «${m.name}», тяги нет:`)
for (let i = 1; i <= 3600; i++) {
  stepWorld(world, 1 / 60, new Map())
  const alt = world.player.state.pos.distanceTo(mm.pos) - mm.radius
  if (i % 300 === 0 || world.player.lastCrashAt > 0) {
    console.log(`  ${(i / 60).toFixed(0).padStart(3)}с: высота ${alt.toFixed(0)} м, вертикальная скорость ${world.player.state.vel.length().toFixed(0)} м/с`)
  }
  if (world.player.lastCrashAt > 0) { console.log('  УДАР'); break }
}
