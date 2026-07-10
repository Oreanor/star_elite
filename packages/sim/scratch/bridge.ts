/** Что получается из сгенерированной системы. Исследование, не тест. */
import { WORLD } from '../src/config/world'
import { createWorld } from '../src/domain/world'
import { jump, jumpDistance } from '../src/domain/galaxy/jump'
import { GALAXY } from '../src/config/galaxy'

const world = createWorld()
const AU = 149_597_870_700
const range = world.player.spec.jumpRange
console.log(`дом: индекс ${WORLD.HOME_INDEX}, «${world.systemName}», привод ${range} св.г.\n`)

const near: number[] = []
for (let i = 1; i < GALAXY.COUNT && near.length < 6; i++) {
  if (i !== world.systemIndex && jumpDistance(world, i) <= range) near.push(i)
}
console.log(`соседей в пределах прыжка (первые 6): ${near.join(', ')}\n`)

for (const i of near.slice(0, 3)) {
  const d = jumpDistance(world, i)
  const w = createWorld()
  jump(w, i)
  const star = w.bodies.find((b) => b.kind === 'star')!
  console.log(`── ${w.systemName}  (${d.toFixed(1)} св.г., индекс ${i})`)
  console.log(`   звезда R=${(star.radius / 1e6).toFixed(0)} тыс. км  (Солнце 696)`)
  for (const b of w.bodies.filter((x) => x.kind === 'planet')) {
    const orbit = b.pos.length() / AU
    console.log(`   ${b.name.padEnd(12)} R=${(b.radius / 1e3).toFixed(0).padStart(6)} км  орбита ${orbit.toFixed(2)} а.е.`)
  }
  const st = w.bodies.find((b) => b.kind === 'station')
  console.log(`   станция: ${st ? st.name : 'нет'} · пиратов ${w.ships.length} · астероидов ${w.asteroids.length}`)
  const startToStation = st ? st.pos.distanceTo(w.player.state.pos) : NaN
  if (st) console.log(`   до причала на старте: ${startToStation.toFixed(0)} м`)
  console.log()
}
