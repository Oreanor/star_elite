/**
 * Нагрев у звезды: за сколько калится корпус, когда течёт, спасает ли побег.
 *
 * Числа задают ОЩУЩЕНИЕ: слишком быстро — не успеешь отвернуть, слишком медленно —
 * не угроза. Меряем, а не угадываем.
 */
import { Vector3 } from 'three'
import { STAR_HEAT } from '../src/config/heat'
import { starExposure, stepStarHeat } from '../src/domain/combat'
import { createWorld, STARTER_SYSTEM, type World } from '../src/domain/world'

const DT = 1 / 120

/** Ставит игрока на заданную высоту над поверхностью звезды (в радиусах). */
function place(world: World, ratio: number): void {
  const star = world.bodies.find((b) => b.kind === 'star')!
  const altitude = star.radius * ratio
  world.player.state.pos.copy(star.pos).add(new Vector3(star.radius + altitude, 0, 0))
}

function fresh(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

console.log(`порог течи ${STAR_HEAT.LEAK_THRESHOLD}, зона ${STAR_HEAT.DANGER_RATIO}–${STAR_HEAT.SAFE_RATIO} радиуса\n`)

console.log('--- сидим на разной высоте: доля облучения ---')
for (const ratio of [0, 0.2, 0.5, 0.8, 1.2, 2]) {
  const w = fresh()
  place(w, ratio)
  console.log(`  высота ${ratio.toFixed(1)} R → облучение ${starExposure(w.player, w).toFixed(2)}`)
}

console.log('\n--- прижались к короне (0.1 R) и сидим ---')
{
  const w = fresh()
  place(w, 0.1)
  const p = w.player
  let leakStart: number | null = null
  let shieldGone: number | null = null
  let dead: number | null = null
  for (let i = 0; i < 120 * 60; i++) {
    w.time += DT
    stepStarHeat(p, w, DT)
    if (leakStart === null && p.hullHeat > STAR_HEAT.LEAK_THRESHOLD) leakStart = w.time
    if (shieldGone === null && p.shield <= 0) shieldGone = w.time
    if (!p.alive) { dead = w.time; break }
  }
  console.log(`  течь началась на ${leakStart?.toFixed(1)} с, щит сгорел к ${shieldGone?.toFixed(1)} с, гибель на ${dead?.toFixed(1) ?? '—'} с`)
}

console.log('\n--- нагрелись и ОТВЕРНУЛИ: спадает ли ---')
{
  const w = fresh()
  place(w, 0.1)
  const p = w.player
  // Калимся 8 секунд.
  for (let i = 0; i < 120 * 8; i++) { w.time += DT; stepStarHeat(p, w, DT) }
  const hot = p.hullHeat
  const hullAfterCook = p.hull
  // Улетаем на безопасную высоту и ждём.
  place(w, 3)
  for (let i = 0; i < 120 * 10; i++) { w.time += DT; stepStarHeat(p, w, DT) }
  console.log(`  нагрев был ${hot.toFixed(2)}, через 10 с вдали стал ${p.hullHeat.toFixed(2)}`)
  console.log(`  корпус за время у звезды: ${hullAfterCook.toFixed(0)} из ${p.spec.hull.hull} (потерь ${(p.spec.hull.hull - hullAfterCook).toFixed(0)})`)
}

console.log('\n--- вдали от звезды нагрева нет вовсе ---')
{
  const w = fresh() // старт в 150 млн км от звезды
  const p = w.player
  for (let i = 0; i < 120 * 30; i++) { w.time += DT; stepStarHeat(p, w, DT) }
  console.log(`  за 30 с у планеты нагрев ${p.hullHeat.toFixed(3)}, щит ${p.shield}, корпус ${p.hull}`)
}
