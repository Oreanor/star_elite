/**
 * Гипертопливо: тратится прыжком, черпается у звезды.
 *
 * Меряем цикл: полный бак → прыжок съедает дальность → у звезды доливается.
 * Проверяем и полку: заправка идёт с 0.5 нагрева, а гореть начинает с 0.85 —
 * между ними надо удержаться.
 */
import { Vector3 } from 'three'
import { HYPERDRIVE, STAR_HEAT } from '../src/config/heat'
import { chargeHyperdrive, scooping, stepStarHeat } from '../src/domain/combat'
import { jump, jumpBlock, jumpDistance, reachableSystems } from '../src/domain/galaxy'
import { createWorld, type World } from '../src/domain/world'

const DT = 1 / 120

function place(world: World, ratio: number): void {
  const star = world.bodies.find((b) => b.kind === 'star')!
  world.player.state.pos.copy(star.pos).add(new Vector3(star.radius * (1 + ratio), 0, 0))
}

const w = createWorld()
const p = w.player
console.log(`бак модели: ${p.spec.jumpRange} св.г, заряжается с ${HYPERDRIVE.CHARGE_HEAT} нагрева, горит с ${STAR_HEAT.LEAK_THRESHOLD}\n`)

const all = Array.from({ length: 2500 }, (_, i) => i)
console.log('--- достижимо на полном баке ---')
console.log(`  систем в радиусе: ${reachableSystems(w, all).length}, заряд ${p.jumpCharge.toFixed(1)}`)

console.log('\n--- три прыжка подряд: бак тает ---')
for (let n = 0; n < 3; n++) {
  const reach = reachableSystems(w, all).filter((i) => i !== w.systemIndex)
  // Берём самый дальний доступный — так бак виднее тает.
  let far = -1
  let farDist = -1
  for (const i of reach) {
    const d = jumpDistance(w, i)
    if (d > farDist) { farDist = d; far = i }
  }
  if (far < 0) { console.log('  прыгать некуда — бак пуст'); break }
  const before = p.jumpCharge
  jump(w, far)
  console.log(`  прыжок на ${farDist.toFixed(1)} св.г: заряд ${before.toFixed(1)} → ${p.jumpCharge.toFixed(1)}, достижимо теперь ${reachableSystems(w, all).length}`)
}

console.log('\n--- полка заправки: где черпается, где горит ---')
{
  const w2 = createWorld()
  const p2 = w2.player
  p2.jumpCharge = 0 // опустошим бак
  for (const ratio of [1.0, 0.6, 0.35, 0.15, 0.05]) {
    const w3 = createWorld()
    const p3 = w3.player
    p3.jumpCharge = 0
    place(w3, ratio)
    // Погреемся 6 секунд на этой высоте и посмотрим, что происходит.
    for (let i = 0; i < 120 * 6; i++) {
      w3.time += DT
      stepStarHeat(p3, w3, DT)
      chargeHyperdrive(p3, DT)
    }
    const state = p3.hull < p3.spec.hull.hull ? 'ГОРИТ' : scooping(p3) ? 'черпает' : p3.hullHeat >= HYPERDRIVE.CHARGE_HEAT ? 'полный' : 'холодно'
    console.log(`  высота ${ratio.toFixed(2)} R: нагрев ${p3.hullHeat.toFixed(2)}, заряд ${p3.jumpCharge.toFixed(1)}, корпус ${p3.hull.toFixed(0)} — ${state}`)
  }
}

console.log('\n--- пустой бак у звезды доливается до полного ---')
{
  const w4 = createWorld()
  const p4 = w4.player
  p4.jumpCharge = 0
  place(w4, 0.35) // на полке: греется, но не горит
  let filledAt: number | null = null
  for (let i = 0; i < 120 * 30; i++) {
    w4.time += DT
    stepStarHeat(p4, w4, DT)
    chargeHyperdrive(p4, DT)
    if (filledAt === null && p4.jumpCharge >= p4.spec.jumpRange - 0.01) filledAt = w4.time
  }
  console.log(`  долился до ${p4.jumpCharge.toFixed(1)} за ${filledAt?.toFixed(1) ?? '—'} с, корпус цел: ${p4.hull === p4.spec.hull.hull}`)
}

console.log('\n--- станция доливает бак мгновенно (см. dock) ---')
{
  const w5 = createWorld()
  console.log(`  старт у станции, блок прыжка домой: ${jumpBlock(w5, 1) ?? 'нет'}`)
}
