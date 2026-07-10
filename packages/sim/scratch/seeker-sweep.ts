/**
 * Две ручки сразу: предел головки и длительность «слепого» участка до включения рулей.
 *
 * Показал, что виноват был слепой участок, а не головка: при 0.15 с попаданий 36 из 42
 * почти независимо от seekerRate. Отсюда armTime и разделение разгона тяги и рулей.
 *
 * Исследование, не тест.
 */
import { Quaternion, Vector3 } from 'three'
import { STARTER_SYSTEM, createWorld } from '../src/domain/world'
import { stepMissiles } from '../src/domain/combat/missiles'
import { fireMissile } from '../src/domain/combat/weapons'
import { GUNNERY } from '../src/config/weapons'

const FIXED_DT = 1 / 120

function shot(range: number, cross: number, seekerRate: number, boostTime: number): boolean {
  const world = createWorld({
    ...STARTER_SYSTEM, belt: null,
    patrols: [{ count: 1, at: [0, 0, -range], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  const enemy = world.ships[0]!
  enemy.ai = null
  enemy.state.pos.set(0, 0, -range)
  enemy.state.vel.set(cross, 0, 0)
  world.player.state.pos.set(0, 0, 0)
  world.player.state.vel.set(0, 0, -80)
  world.player.state.quat.copy(new Quaternion())
  fireMissile(world, world.player, enemy.id)
  const m = world.missiles[0]!
  m.module = { ...m.module, seekerRate, boostTime }
  let closest = Infinity
  for (let s = 0; s < 120 * 14; s++) {
    world.time += FIXED_DT
    enemy.state.pos.addScaledVector(enemy.state.vel, FIXED_DT)
    stepMissiles(world, FIXED_DT)
    closest = Math.min(closest, m.pos.distanceTo(enemy.state.pos))
    if (!m.alive) break
  }
  return closest < GUNNERY.MISSILE_PROXIMITY + 1
}

const RANGES = [250, 300, 400, 500, 700, 1000, 1500]
const CROSS = [0, 40, 80, 120, 180, 220]
const total = RANGES.length * CROSS.length

console.log('попаданий из ' + total + ' (дальность 250…1500 м × поперечная 0…220 м/с)\n')
console.log('             boost 0.55   0.35   0.25   0.15')
for (const rate of [0.35, 1.25, 2.5, 3.75, 5]) {
  const row = [0.55, 0.35, 0.25, 0.15].map((b) => {
    let h = 0
    for (const r of RANGES) for (const c of CROSS) if (shot(r, c, rate, b)) h++
    return String(h).padStart(6)
  })
  console.log(`seeker ${String(rate).padEnd(5)} ${row.join(' ')}`)
}
