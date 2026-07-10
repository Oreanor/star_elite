/**
 * Двойные звёзды: сколько их, какие периоды, как далеко разнесены.
 *
 * Период выводится из массы, а не назначается, — значит его надо ПОМЕРИТЬ, а не
 * задать. Настоящие тесные пары обходятся за дни; проверяем, что и у нас так, а
 * не за десять минут (тогда звезда носилась бы мимо корабля быстрее ракеты).
 */
import { Vector3 } from 'three'
import { GALAXY } from '../src/config/galaxy'
import { generateGalaxy } from '../src/domain/galaxy/generate'
import { systemDefFor } from '../src/domain/galaxy/jump'
import { createWorld, type World } from '../src/domain/world'
import { enterSystem } from '../src/domain/world/factory'
import { stepOrbits } from '../src/domain/world/orbits'

const galaxy = generateGalaxy(GALAXY.SEED)
const binaries = galaxy.filter((s) => s.companion)
console.log(`двойных ${binaries.length} из ${galaxy.length} (${((100 * binaries.length) / galaxy.length).toFixed(0)}%)`)

console.log('\n--- первые пять двойных: период и разнос ---')
for (const sys of binaries.slice(0, 5)) {
  const def = systemDefFor(sys.index, GALAXY.SEED)
  const world = createWorld({ ...def, patrols: [], belt: null })
  const stars = world.bodies.filter((b) => b.kind === 'star')
  const [a, b] = stars
  if (!a || !b || !a.orbit) continue

  const days = (2 * Math.PI) / a.orbit.rate / 86_400
  const gap = a.pos.distanceTo(b.pos)
  const speed = a.orbit.rate * a.orbit.radius
  console.log(
    `${sys.name.padEnd(12)} ${sys.star.className.padEnd(16)} ` +
      `R ${(a.radius / 1e6).toFixed(0)}+${(b.radius / 1e6).toFixed(0)} тыс.км  ` +
      `разнос ${(gap / 1e6).toFixed(0).padStart(5)} тыс.км  период ${days.toFixed(1).padStart(6)} сут  ` +
      `звезда идёт ${(speed / 1000).toFixed(0)} км/с`,
  )
}

console.log('\n--- барицентр неподвижен: центр масс держится в нуле ---')
{
  const sys = binaries[0]!
  const def = systemDefFor(sys.index, GALAXY.SEED)
  const world: World = createWorld({ ...def, patrols: [], belt: null })
  const stars = () => world.bodies.filter((b) => b.kind === 'star')
  const [a, b] = stars()
  if (a && b && a.orbit && b.orbit) {
    const density = 1408
    const mass = (r: number) => density * (4 / 3) * Math.PI * r ** 3
    const ma = mass(a.radius)
    const mb = mass(b.radius)
    // Барицентр в локальных координатах стоит не в нуле, а в −originOffset
    // (плавающее начало уехало на 150 млн км к планете). Важно, что он НЕ ДВИЖЕТСЯ:
    // меряем не расстояние до нуля, а разброс между кадрами.
    const centre = new Vector3()
    const first = new Vector3()
    let worst = 0
    for (let s = 0; s <= 30; s++) {
      world.time = s * 86_400 // сутки за шаг
      stepOrbits(world)
      centre.copy(a.pos).multiplyScalar(ma).addScaledVector(b.pos, mb).divideScalar(ma + mb)
      if (s === 0) first.copy(centre)
      worst = Math.max(worst, centre.distanceTo(first))
    }
    console.log(`центр масс за месяц сместился не более чем на ${worst.toFixed(3)} м (разнос ${(a.pos.distanceTo(b.pos) / 1e6).toFixed(0)} тыс.км)`)
  }
}

console.log('\n--- прыжок в двойную не роняет мир ---')
{
  const sys = binaries[0]!
  const world = createWorld()
  enterSystem(world, systemDefFor(sys.index, GALAXY.SEED), sys.index)
  const stars = world.bodies.filter((b) => b.kind === 'star')
  console.log(`в системе ${sys.name} звёзд: ${stars.length}, у игрока высота над ближайшей ` +
    `${(Math.min(...stars.map((s) => s.pos.distanceTo(world.player.state.pos) - s.radius)) / 1e9).toFixed(1)} млн км`)
}
