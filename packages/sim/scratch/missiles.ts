/**
 * Почему ракеты не попадают.
 *
 * Цель идёт по окружности с максимальной для корабля угловой скоростью — это
 * лучшее, что умеет пилот. Считаем: срывается ли головка, и если да, то на каком
 * расстоянии. Взрыватель срабатывает на 14 м, значит срыв дальше этого = промах.
 *
 * Исследование, не тест.
 */
import { Vector3 } from 'three'
import { MISSILE_PYLON } from '../src/config/modules'
import { GUNNERY } from '../src/config/weapons'
import type { MissileModule } from '../src/domain/loadout'

const FIXED_DT = 1 / 120

interface Result {
  hit: boolean
  breakAt: number | null
  missBy: number
  time: number
}

/**
 * Один пуск. Цель кружит с угловой скоростью `omega` на скорости `targetSpeed`.
 * @param nav Коэффициент пропорционального наведения. 0 — чистая погоня (как сейчас).
 */
function run(mod: MissileModule, launchRange: number, targetSpeed: number, omega: number, nav = 0): Result {
  const pos = new Vector3(0, 0, 0)
  // Ракета сходит с пилона уже носом на цель — упреждения на пуске нет.
  const vel = new Vector3(0, 0, -1).multiplyScalar(mod.speed)

  const tPos = new Vector3(0, 0, -launchRange)
  let heading = Math.PI / 2 // цель уходит поперёк: худший случай для головки
  let locked = true
  let breakAt: number | null = null
  let closest = Infinity

  for (let step = 0; step * FIXED_DT < mod.lifetime; step++) {
    const t = step * FIXED_DT

    heading += omega * FIXED_DT
    const tVel = new Vector3(Math.cos(heading), 0, Math.sin(heading)).multiplyScalar(targetSpeed)
    tPos.addScaledVector(tVel, FIXED_DT)

    const toTarget = tPos.clone().sub(pos)
    const distance = toTarget.length()
    closest = Math.min(closest, distance)
    if (distance < GUNNERY.MISSILE_PROXIMITY) return { hit: true, breakAt, missBy: distance, time: t }

    toTarget.divideScalar(distance)

    if (locked) {
      // Угловая скорость линии визирования: v⊥ / d.
      const rel = tVel.clone().sub(vel)
      rel.addScaledVector(toTarget, -rel.dot(toTarget))
      const losRate = rel.length() / Math.max(distance, 1)

      if (losRate > mod.seekerRate) {
        locked = false
        breakAt = distance
      } else if (nav > 0) {
        // Пропорциональное наведение: доворачиваем со скоростью N·Ω, где Ω —
        // вектор вращения линии визирования. Ω → 0 значит курс столкновения.
        const relVel = tVel.clone().sub(vel)
        const omegaLos = toTarget.clone().cross(relVel).divideScalar(distance)
        const rate = omegaLos.length() * nav
        const dir = vel.clone().normalize()
        if (rate > 1e-6) {
          const axis = omegaLos.clone().normalize()
          dir.applyAxisAngle(axis, Math.min(rate, mod.turnRate) * FIXED_DT)
        }
        vel.copy(dir).multiplyScalar(mod.speed)
      } else {
        const dir = vel.clone().normalize()
        const angle = Math.acos(Math.max(-1, Math.min(1, dir.dot(toTarget))))
        const axis = dir.clone().cross(toTarget)
        if (axis.lengthSq() > 1e-8) {
          axis.normalize()
          dir.applyAxisAngle(axis, Math.min(angle, mod.turnRate * FIXED_DT))
        }
        vel.copy(dir).multiplyScalar(mod.speed)
      }
    }
    pos.addScaledVector(vel, FIXED_DT)
  }
  return { hit: false, breakAt, missBy: closest, time: mod.lifetime }
}

/** Цель летит прямо и рвёт курс, лишь когда ракета подошла на `breakDist`. */
function runLateBreak(
  mod: MissileModule,
  launchRange: number,
  targetSpeed: number,
  omega: number,
  breakDist: number,
  nav: number,
): Result {
  const pos = new Vector3(0, 0, 0)
  const vel = new Vector3(0, 0, -1).multiplyScalar(mod.speed)
  const tPos = new Vector3(0, 0, -launchRange)
  let heading = Math.PI / 2
  let locked = true
  let breakAt: number | null = null
  let closest = Infinity

  for (let step = 0; step * FIXED_DT < mod.lifetime; step++) {
    const t = step * FIXED_DT
    const distanceNow = tPos.distanceTo(pos)
    if (distanceNow < breakDist) heading += omega * FIXED_DT

    const tVel = new Vector3(Math.cos(heading), 0, Math.sin(heading)).multiplyScalar(targetSpeed)
    tPos.addScaledVector(tVel, FIXED_DT)

    const toTarget = tPos.clone().sub(pos)
    const distance = toTarget.length()
    closest = Math.min(closest, distance)
    if (distance < GUNNERY.MISSILE_PROXIMITY) return { hit: true, breakAt, missBy: distance, time: t }
    toTarget.divideScalar(distance)

    if (locked) {
      const rel = tVel.clone().sub(vel)
      const perp = rel.clone().addScaledVector(toTarget, -rel.dot(toTarget))
      if (perp.length() / Math.max(distance, 1) > mod.seekerRate) {
        locked = false
        breakAt = distance
      } else {
        const omegaLos = toTarget.clone().cross(rel).divideScalar(distance)
        const dir = vel.clone().normalize()
        const rate = omegaLos.length() * nav
        if (rate > 1e-6) dir.applyAxisAngle(omegaLos.clone().normalize(), Math.min(rate, mod.turnRate) * FIXED_DT)
        vel.copy(dir).multiplyScalar(mod.speed)
      }
    }
    pos.addScaledVector(vel, FIXED_DT)
  }
  return { hit: false, breakAt, missBy: closest, time: mod.lifetime }
}

const TARGET_SPEED = 180 // м/с — обычный боевой ход
const OMEGA = 1.2 // рад/с — предел разворота корабля

console.log('ЦЕЛЬ: идёт поперёк на 180 м/с и крутит вираж на пределе (1.2 рад/с).')
console.log(`Взрыватель: ${GUNNERY.MISSILE_PROXIMITY} м. Срыв дальше него — промах.\n`)

console.log('── КАК СЕЙЧАС ' + '─'.repeat(50))
console.log(`скорость ${MISSILE_PYLON.speed} м/с, головка ${MISSILE_PYLON.seekerRate} рад/с, разворот ${MISSILE_PYLON.turnRate} рад/с`)
for (const range of [400, 800, 1500, 2500]) {
  const r = run(MISSILE_PYLON, range, TARGET_SPEED, OMEGA)
  const срыв = r.breakAt === null ? 'нет' : `на ${r.breakAt.toFixed(0)} м`
  console.log(`  пуск с ${String(range).padStart(4)} м → ${r.hit ? 'ПОПАЛА' : 'мимо'}, срыв ${срыв.padEnd(10)} промах ${r.missBy.toFixed(0)} м`)
}

const RANGES = [400, 800, 1500, 2500]
const SEEKERS = [0.35, 1.0, 2.0, 3.0, 4.5]

console.log('\n── ПОГОНЯ: скорость × головка ' + '─'.repeat(34))
console.log('           ' + SEEKERS.map((s) => `гол.${s}`.padStart(8)).join(''))
for (const speed of [420, 550, 700, 850]) {
  const cells = SEEKERS.map((seekerRate) => {
    const mod = { ...MISSILE_PYLON, speed, seekerRate }
    // Попадание должно быть надёжным со всех дистанций, а не с одной удачной.
    const hits = RANGES.filter((r) => run(mod, r, TARGET_SPEED, OMEGA).hit).length
    return `${hits}/4`.padStart(8)
  })
  console.log(`  ${String(speed).padStart(4)} м/с${cells.join('')}`)
}

console.log('\n── ПРОПОРЦИОНАЛЬНОЕ НАВЕДЕНИЕ (N=3.5): скорость × головка ' + '─'.repeat(7))
console.log('           ' + SEEKERS.map((s) => `гол.${s}`.padStart(8)).join(''))
for (const speed of [420, 550, 700, 850]) {
  const cells = SEEKERS.map((seekerRate) => {
    const mod = { ...MISSILE_PYLON, speed, seekerRate }
    const hits = RANGES.filter((r) => run(mod, r, TARGET_SPEED, OMEGA, 3.5).hit).length
    return `${hits}/4`.padStart(8)
  })
  console.log(`  ${String(speed).padStart(4)} м/с${cells.join('')}`)
}

console.log('\n── Коэффициент N при скорости 550, головке 2.5 ' + '─'.repeat(18))
for (const nav of [0, 2, 3, 3.5, 4, 5]) {
  const mod = { ...MISSILE_PYLON, speed: 550, seekerRate: 2.5 }
  const hits = RANGES.filter((r) => run(mod, r, TARGET_SPEED, OMEGA, nav).hit).length
  console.log(`  N=${nav.toFixed(1)} → ${hits}/4 попаданий${nav === 0 ? '   (чистая погоня)' : ''}`)
}

console.log('\n── Ровный вираж от ПН не спасает (N=3.5, 550 м/с, гол. 2.5) ' + '─'.repeat(5))
const tuned = { ...MISSILE_PYLON, speed: 550, seekerRate: 2.5 }
for (const omega of [0.4, 1.2, 2.0]) {
  const r = run(tuned, 1200, TARGET_SPEED, omega, 3.5)
  console.log(`  вираж ${omega.toFixed(1)} рад/с → ${r.hit ? 'ПОПАЛА' : `ушёл (промах ${r.missBy.toFixed(0)} м)`}`)
}

/**
 * Поздний срыв. Пропорциональное наведение гасит вращение линии визирования —
 * значит, обмануть его можно только тем, что оно не предсказывает: РЕЗКИМ
 * изменением курса вблизи. Тогда требуемое Ω взлетает, и упирается либо
 * в предел разворота ракеты, либо в предел слежения головки.
 */
console.log('\n── Поздний рывок: цель идёт прямо, ломает курс с dist < X ' + '─'.repeat(6))
for (const seekerRate of [0.35, 1.2, 2.5, 4.0]) {
  const row: string[] = []
  for (const breakDist of [500, 300, 180, 100]) {
    const mod = { ...MISSILE_PYLON, speed: 550, seekerRate }
    const r = runLateBreak(mod, 1800, TARGET_SPEED, 1.6, breakDist, 3.5)
    row.push((r.hit ? 'попала' : `ушёл ${r.missBy.toFixed(0)}м`).padStart(11))
  }
  console.log(`  головка ${seekerRate.toFixed(2)}:${row.join('')}`)
}
console.log('  (столбцы: рывок начат за 500 / 300 / 180 / 100 м до ракеты)')
