/**
 * Ракеты уходят «куда-то» при пуске с 500 м. Ищем, ГДЕ теряется полезное действие,
 * прежде чем крутить числа.
 *
 * Здесь не идеализированный пуск (ракета уже носом на цель, уже на полной
 * скорости), а настоящий конвейер: сход с пилона со скоростью носителя, разгон
 * `boostTime` без рулей и без головки, и только потом наведение.
 *
 * Печатаем: когда сорвался захват, на каком расстоянии, и с каким промахом.
 * Исследование, не тест.
 */
import { Quaternion, Vector3 } from 'three'
import { STARTER_SYSTEM, createWorld } from '../src/domain/world'
import type { World } from '../src/domain/world/entities'
import { stepMissiles } from '../src/domain/combat/missiles'
import { fireMissile } from '../src/domain/combat/weapons'
import { GUNNERY } from '../src/config/weapons'

const FIXED_DT = 1 / 120

/** Мир с одним врагом ровно по курсу на дистанции `range`. */
function setup(range: number, crossSpeed: number): World {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -range], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  const enemy = world.ships[0]!
  // Стенд меряет наведение, а не бой: ИИ выключен, цель идёт равномерно поперёк.
  enemy.ai = null
  enemy.state.pos.set(0, 0, -range)
  enemy.state.vel.set(crossSpeed, 0, 0)

  const p = world.player
  p.state.pos.set(0, 0, 0)
  p.state.vel.set(0, 0, -80) // обычная боевая скорость
  p.state.quat.copy(new Quaternion()) // нос в −Z, прямо на цель
  world.lockedTargetId = enemy.id
  return world
}

function shot(range: number, crossSpeed: number): string {
  const world = setup(range, crossSpeed)
  const enemy = world.ships[0]!
  if (!fireMissile(world, world.player, enemy.id)) return 'пуск не состоялся'

  const m = world.missiles[0]!
  const born = world.time
  let lockLostAt: number | null = null
  let lockLostRange = 0
  let closest = Infinity

  for (let step = 0; step < 120 * 14; step++) {
    world.time += FIXED_DT
    // Цель летит сама: физику корабля не зовём, нам нужна только кинематика.
    enemy.state.pos.addScaledVector(enemy.state.vel, FIXED_DT)

    const hadTarget = m.targetId !== null
    stepMissiles(world, FIXED_DT)

    const d = m.pos.distanceTo(enemy.state.pos)
    closest = Math.min(closest, d)

    if (hadTarget && m.targetId === null && lockLostAt === null) {
      lockLostAt = world.time - born
      lockLostRange = d
    }
    if (!m.alive) {
      const hit = closest < GUNNERY.MISSILE_PROXIMITY + 1
      const lock = lockLostAt === null ? 'захват цел' : `СРЫВ на ${lockLostAt.toFixed(2)} с, ${lockLostRange.toFixed(0)} м`
      return `${hit ? 'ПОПАЛА' : 'мимо'}  промах ${closest.toFixed(1)} м  · ${lock}`
    }
  }
  return `не долетела, промах ${closest.toFixed(1)} м`
}

console.log(`разгон ${0.55} с без рулей и без головки; порог головки 0.35 рад/с\n`)
for (const range of [400, 500, 800, 1200, 2000]) {
  console.log(`— пуск с ${range} м —`)
  for (const cross of [0, 40, 80, 120, 180]) {
    console.log(`   цель поперёк ${String(cross).padStart(3)} м/с:  ${shot(range, cross)}`)
  }
}
