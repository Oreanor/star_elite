/**
 * Осталась ли у пилота ПРОТИВОракетная механика?
 *
 * Уйти от ракеты нельзя: её боковое ускорение v·ω = 550×1.25 ≈ 690 м/с², семьдесят g
 * против шестнадцати у «Авроры». Единственный шанс — сорвать головку: Ω = v⊥/d растёт
 * при сближении, и рывок вбок У САМОГО НОСА ракеты она отработать не успевает.
 *
 * Меряем: с какой дистанции рывок ещё срывает захват. Исследование, не тест.
 */
import { Quaternion, Vector3 } from 'three'
import { STARTER_SYSTEM, createWorld } from '../src/domain/world'
import { stepMissiles } from '../src/domain/combat/missiles'
import { fireMissile } from '../src/domain/combat/weapons'
import { GUNNERY } from '../src/config/weapons'

const FIXED_DT = 1 / 120

/** Цель летит прямо, пока ракета не подойдёт на `jinkAt`, затем рвёт вбок на `lateral`. */
function run(jinkAt: number, lateral: number): string {
  const world = createWorld({
    ...STARTER_SYSTEM, belt: null,
    patrols: [{ count: 1, at: [0, 0, -1500], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  const enemy = world.ships[0]!
  enemy.ai = null
  enemy.state.pos.set(0, 0, -1500)
  enemy.state.vel.set(0, 0, -120) // уходит от нас по прямой
  world.player.state.pos.set(0, 0, 0)
  world.player.state.vel.set(0, 0, -80)
  world.player.state.quat.copy(new Quaternion())
  fireMissile(world, world.player, enemy.id)
  const m = world.missiles[0]!

  let jinked = false
  let closest = Infinity
  let brokeAt: number | null = null

  for (let s = 0; s < 120 * 14; s++) {
    world.time += FIXED_DT
    const d = m.pos.distanceTo(enemy.state.pos)
    if (!jinked && d < jinkAt) {
      jinked = true
      enemy.state.vel.set(lateral, 0, -120) // рывок вбок, скорость по модулю растёт
    }
    enemy.state.pos.addScaledVector(enemy.state.vel, FIXED_DT)
    const had = m.targetId !== null
    stepMissiles(world, FIXED_DT)
    if (had && m.targetId === null && brokeAt === null) brokeAt = m.pos.distanceTo(enemy.state.pos)
    closest = Math.min(closest, m.pos.distanceTo(enemy.state.pos))
    if (!m.alive) break
  }
  const hit = closest < GUNNERY.MISSILE_PROXIMITY + 1
  return `${hit ? 'ракета попала' : 'УВЕРНУЛСЯ'}  промах ${closest.toFixed(0).padStart(4)} м` +
    (brokeAt !== null ? `  · срыв на ${brokeAt.toFixed(0)} м` : '  · захват цел')
}

console.log('рывок вбок на скорости 220 м/с (предел «Авроры») с разных дистанций\n')
for (const at of [400, 200, 150, 120, 100, 80, 60, 40]) {
  console.log(`  рывок за ${String(at).padStart(3)} м до ракеты:  ${run(at, 220)}`)
}
console.log('\nтот же рывок, но вялый — 90 м/с\n')
for (const at of [150, 100, 60, 40]) {
  console.log(`  рывок за ${String(at).padStart(3)} м до ракеты:  ${run(at, 90)}`)
}
