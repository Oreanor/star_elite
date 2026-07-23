/**
 * Опасна ли ЗАМОРОЖЕННАЯ точка выхода портала.
 *
 * Устье считается ОДИН раз — при открытии кольца. Дальше вторая система живёт: планета
 * идёт вокруг звезды, станция — вокруг планеты. Планета уезжает ВБОК, от замороженной
 * точки она только удаляется, так что сама по себе она не опасна.
 *
 * Подозрение другое: у планеты с причалом отход считается ОТ СТАНЦИИ, а станция висит на
 * орбите в тысячах км от поверхности. Точка выхода тогда лежит фактически НА СТАНЦИОННОЙ
 * ОРБИТЕ — и стоит станции уползти по ней, как замороженная точка оказывается над самой
 * планетой, а то и под её поверхностью.
 *
 * Запуск: npx tsx packages/sim/scratch/arrival-drift.ts
 */
import { Vector3 } from 'three'
import { ARRIVAL, GALAXY } from '../src/config'
import { systemDefFor } from '../src/domain/galaxy/jump'
import { arrivalPointAt } from '../src/domain/galaxy/arrival'
import { layoutSystemBodies } from '../src/domain/world/factory'

const HOLD = [0, 2.5, 5, 10, 30, 60]
const km = (m: number) => (m / 1000).toFixed(0)

console.log(`отход от поверхности по конфигу: ${km(ARRIVAL.STANDOFF)} км\n`)

for (const index of [1, 42, 1549, 777]) {
  const def = systemDefFor(index, GALAXY.SEED)
  const bodies0 = layoutSystemBodies(def, 0)
  const station0 = bodies0.find((b) => b.kind === 'station')
  const planets0 = bodies0.filter((b) => b.kind === 'planet')
  if (!station0 || planets0.length === 0) continue

  // Планета причала — ближайшая к станции: сама станция висит на её орбите.
  let seat = 0
  let best = Infinity
  for (let i = 0; i < planets0.length; i++) {
    const d = planets0[i]!.pos.distanceTo(station0.pos)
    if (d < best) {
      best = d
      seat = i
    }
  }

  const frozen = new Vector3(...arrivalPointAt(def, { kind: 'body', planet: seat }, 0))
  const planet0 = planets0[seat]!
  console.log(
    `— система ${index} «${def.name}»: планета R=${km(planet0.radius)} км, ` +
    `станция на ${km(best - planet0.radius)} км над поверхностью`,
  )

  for (const hold of HOLD) {
    const bodies = layoutSystemBodies(def, hold)
    const planet = bodies.filter((b) => b.kind === 'planet')[seat]!
    const station = bodies.find((b) => b.kind === 'station')!
    const overSurface = frozen.distanceTo(planet.pos) - planet.radius
    const toStation = frozen.distanceTo(station.pos)
    const verdict = overSurface < 0 ? 'ВНУТРИ ПЛАНЕТЫ' : overSurface < 200_000 ? 'опасно близко' : 'чисто'
    console.log(
      `  ${String(hold).padStart(4)}с: до поверхности ${km(overSurface).padStart(6)} км — ${verdict}` +
      `; до причала ${km(toStation)} км`,
    )
  }
  console.log()
}
