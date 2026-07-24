/**
 * Сколько ПРИЧАЛОВ рождает генератор на систему.
 *
 * Станция — свойство заселённой планеты, а не системы, поэтому многопричальные системы
 * каталог уже умеет. Вопрос лишь в том, как часто они выпадают — считаем, а не гадаем.
 */
import { GALAXY } from '../src/config/galaxy'
import { generateSystem } from '../src/domain/galaxy/generate'
import { stationsOf } from '../src/domain/galaxy/types'

const histogram = new Map<number, number>()
let inhabited = 0

for (let index = 0; index < GALAXY.COUNT; index++) {
  const system = generateSystem(index, GALAXY.SEED)
  const count = stationsOf(system).length
  histogram.set(count, (histogram.get(count) ?? 0) + 1)
  if (system.planets.some((p) => p.settlement)) inhabited++
}

console.log(`систем всего: ${GALAXY.COUNT}, с населением: ${inhabited}`)
console.log('причалов в системе:')
for (const [count, n] of [...histogram].sort((a, b) => a[0] - b[0])) {
  const share = ((n / GALAXY.COUNT) * 100).toFixed(1)
  console.log(`  ${count}: ${String(n).padStart(5)}  ${share.padStart(5)}%  ${'#'.repeat(Math.round(n / 25))}`)
}
