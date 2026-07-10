/** Плотность звёзд и орбиты планет. Исследование, не тест. */
import { GALAXY } from '../src/config/galaxy'
import { WORLD } from '../src/config/world'
import { generateSystem } from '../src/domain/galaxy/generate'
import { distanceLy, placeSystem } from '../src/domain/galaxy/shape'

const home = placeSystem(WORLD.HOME_INDEX)
console.log(`дом на радиусе ${Math.hypot(home.x, home.y).toFixed(1)} св.г. от центра\n`)

const dists: number[] = []
for (let i = 0; i < GALAXY.COUNT; i++) {
  if (i === WORLD.HOME_INDEX) continue
  dists.push(distanceLy(home, placeSystem(i)))
}
dists.sort((a, b) => a - b)
console.log('ближайшие 10 соседей, св.г.:', dists.slice(0, 10).map((d) => d.toFixed(1)).join(' '))
for (const r of [5, 9, 16, 28]) console.log(`  в радиусе ${String(r).padStart(2)} св.г.: ${dists.filter((d) => d <= r).length} звёзд`)

console.log('\nорбиты планет системы 95, безразмерные:')
for (const p of generateSystem(95).planets) console.log(`  ${p.name.padEnd(12)} orbit=${p.orbit}`)
