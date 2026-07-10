/** Что за луны получились: радиусы, орбиты, периоды. */
import { createWorld } from '../src/domain/world'
import { systemDefFor } from '../src/domain/galaxy/jump'
import { GALAXY } from '../src/config/galaxy'

const w = createWorld()
for (const b of w.bodies) {
  const o = b.orbit
  const orbit = o ? `орбита ${(o.radius / 1e6).toFixed(0)} тыс.км, период ${(((2 * Math.PI) / o.rate) / 86400).toFixed(1)} сут` : ''
  console.log(b.kind.padEnd(8), b.name.padEnd(16), `R=${(b.radius / 1000).toFixed(0).padStart(7)} км`, orbit)
}
const moon = w.bodies.find((b) => b.kind === 'moon')!
console.log('\nдо луны от старта:', (moon.pos.distanceTo(w.player.state.pos) / 1e6).toFixed(1), 'тыс. км')

console.log('\n--- сколько лун в первых системах галактики ---')
let total = 0, planets = 0
for (let i = 0; i < 200; i++) {
  const def = systemDefFor(i, GALAXY.SEED)
  for (const p of def.planets) { planets++; total += p.moons.length }
}
console.log(`планет ${planets}, лун ${total}, в среднем ${(total / planets).toFixed(2)} на планету`)
