/**
 * Насколько уезжает ТОЧКА ВЫХОДА, пока пилот раскрывает кольцо и смотрит в окно.
 *
 * Портал считает дальнее устье ОДИН раз — при открытии, по положению тел на тот момент.
 * Дальше вторая система живёт: планеты идут по орбитам, а время в игре сжато. Вопрос,
 * который решает эта прикидка: успевает ли тело за секунды ожидания подойти к точке
 * выхода настолько, чтобы пилот вывалился ему в бок.
 *
 * Запуск: npx tsx packages/sim/scratch/arrival-drift.ts
 */
import { ARRIVAL, GALAXY, TIME } from '../src/config'
import { systemDefFor } from '../src/domain/galaxy/jump'
import { layoutSystemBodies } from '../src/domain/world/factory'

const HOLD_SECONDS = [2.5, 5, 10, 30]

console.log(`сжатие времени: ${TIME.SCALE}×, отход от поверхности: ${(ARRIVAL.STANDOFF / 1000).toFixed(0)} км\n`)

for (const index of [1, 7, 42, 1549]) {
  const def = systemDefFor(index, GALAXY.SEED)
  const bodies = layoutSystemBodies(def, 0)
  const planets = bodies.filter((b) => b.kind === 'planet')
  if (planets.length === 0) continue

  console.log(`— система ${index} «${def.name}»`)
  for (let i = 0; i < planets.length; i++) {
    const at = (t: number) => layoutSystemBodies(def, t).filter((b) => b.kind === 'planet')[i]!.pos
    const p0 = at(0)
    const line = HOLD_SECONDS.map((hold) => {
      // calendarTime — РЕАЛЬНЫЕ секунды: orbitSec тождественна, сжатие ×480 только для дат.
      const moved = at(hold).distanceTo(p0)
      return `${hold}с: ${(moved / 1000).toFixed(0)} км`
    }).join('  ')
    const planet = planets[i]!
    console.log(`  планета ${i} R=${(planet.radius / 1000).toFixed(0)} км  ${line}`)
  }
  console.log()
}
