import { generateGalaxy } from '../src/domain/galaxy/generate'
import { GALAXY } from '../src/config/galaxy'

/**
 * Плотность галактики для галактического слоя миелофона: сколько звёзд попадает в
 * сферу отрисовки радиусом R световых лет вокруг типичной звезды. Отсюда выбираем
 * и сферу, и ожидаемое число точек на масштабе подмены.
 */
const g = generateGalaxy()
const n = g.length
const pos = g.map((s) => [s.x, s.y, s.z] as const)

function countWithin(i: number, R: number): number {
  const [ax, ay, az] = pos[i]!
  let c = 0
  for (let j = 0; j < n; j++) {
    if (j === i) continue
    const [bx, by, bz] = pos[j]!
    const dx = ax - bx, dy = ay - by, dz = az - bz
    if (dx * dx + dy * dy + dz * dz <= R * R) c++
  }
  return c
}

function stats(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b)
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length
  const med = s[Math.floor(s.length / 2)]!
  const p90 = s[Math.floor(s.length * 0.9)]!
  return { avg, med, min: s[0]!, max: s[s.length - 1]!, p90 }
}

console.log(`галактика: ${n} звёзд, диск R=${GALAXY.RADIUS_LY} св.г, толщина ±${GALAXY.THICKNESS_LY}`)
console.log(`дальность прыжка (для сравнения): ${GALAXY.BASE_JUMP_RANGE} св.г\n`)
console.log('R,св.г | сред | медиана | p90 | макс  (соседей в сфере)')

const radii = [3, 5, 7, 10, 15, 20, 27, 40, 60]
for (const R of radii) {
  const counts = g.map((_, i) => countWithin(i, R))
  const { avg, med, p90, max } = stats(counts)
  console.log(
    `${String(R).padStart(5)} | ${avg.toFixed(1).padStart(4)} | ${String(med).padStart(7)} | ${String(p90).padStart(3)} | ${String(max).padStart(4)}`,
  )
}

// Перевод: на масштабе S сфера SPHERE_RADIUS_M метров = радиус R_ly = SPHERE_RADIUS_M·S/LY_TO_M.
const LY_TO_M = 6e10
console.log(`\nПри LY_TO_M=${LY_TO_M.toExponential(0)}:`)
for (const S of [1e5, 3e5, 1e6, 3e6]) {
  console.log(`  масштаб ${S.toExponential(0)}:  R_ly = SPHERE_M·${(S / LY_TO_M).toExponential(2)}`)
}
console.log('  (т.е. чтобы на 1e6 видеть радиус R_ly, надо SPHERE_M = R_ly · 6e4)')
