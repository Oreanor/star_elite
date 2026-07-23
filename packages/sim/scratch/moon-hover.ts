/**
 * Почему борт разбивается о луну, вися над ней в полукилометре.
 *
 * Ставим корабль на 500 м над поверхностью крупной луны — сначала неподвижно, потом с
 * ходом вдоль поверхности, — и гоняем настоящий шаг мира. Печатаем высоту по кадрам и
 * ловим момент, когда домен засчитает удар (`lastCrashAt`).
 *
 * Запуск: npx tsx packages/sim/scratch/moon-hover.ts
 */
import { Vector3 } from 'three'
import { createWorld, STARTER_SYSTEM } from '../src/domain/world'
import { stepWorld } from '../src/domain/sim/step'

const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
const moon = world.bodies.filter((b) => b.kind === 'moon').sort((a, b) => b.radius - a.radius)[0]
if (!moon) throw new Error('в стартовой системе нет луны')

const km = (m: number) => (m / 1000).toFixed(2)
console.log(`луна «${moon.name}» R=${km(moon.radius)} км, радиус корпуса ${world.player.spec.hull.radius} м\n`)

for (const speed of [0, 200, 2000]) {
  const w = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
  const m = w.bodies.filter((b) => b.kind === 'moon').sort((a, b) => b.radius - a.radius)[0]!
  const up = new Vector3(0, 1, 0)
  const along = new Vector3(1, 0, 0)

  w.player.state.pos.copy(m.pos).addScaledVector(up, m.radius + 500)
  w.player.state.vel.copy(along).multiplyScalar(speed)
  w.player.lastCrashAt = -1

  let crashedAt = -1
  let minAlt = Infinity
  for (let i = 0; i < 240; i++) {
    stepWorld(w, 1 / 60, new Map())
    const alt = w.player.state.pos.distanceTo(m.pos) - m.radius
    minAlt = Math.min(minAlt, alt)
    if (crashedAt < 0 && w.player.lastCrashAt > 0) crashedAt = i
  }
  console.log(
    `ход ${String(speed).padStart(4)} м/с: минимальная высота ${km(minAlt)} км` +
    (crashedAt >= 0 ? `, УДАР на кадре ${crashedAt}` : ', удара нет'),
  )
}
