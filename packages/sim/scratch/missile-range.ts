/**
 * Дальность ракеты: с какой дистанции она ещё достаёт цель.
 *
 * Числа в конфиге — это скорость и время жизни, а не дальность. Реальная
 * дальность поражения зависит от СКОРОСТИ СБЛИЖЕНИЯ: убегающая цель вычитает
 * свою скорость из ракетной, и путь, который ракета успевает отыграть за свои
 * lifetime секунд, сокращается втрое.
 *
 * Исследование, не тест.
 */
import { Vector3 } from 'three'
import { MISSILE_PYLON } from '../src/config/modules'
import { fireMissile } from '../src/domain/combat/weapons'
import { stepMissiles } from '../src/domain/combat/missiles'
import { hardpointIndices } from '../src/domain/loadout'
import { createWorld, STARTER_SYSTEM } from '../src/domain/world'
import { refreshSpec } from '../src/domain/world/factory'
import type { World } from '../src/domain/world'

const DT = 1 / 120

/**
 * @param targetVz скорость цели вдоль мировой Z, м/с. Игрок летит в −Z со 200 м/с,
 *   значит −200 — цель идёт с нами вровень, 0 — висит, +200 — летит навстречу.
 */
function scenario(distance: number, targetVz: number, label: string): void {
  const world: World = createWorld({ ...STARTER_SYSTEM, patrols: [STARTER_SYSTEM.patrols[0]!], belt: null })
  const player = world.player
  const enemy = world.ships[0]!

  // Игрок в нуле, нос в −Z. Цель прямо по курсу на заданной дистанции.
  player.state.pos.set(0, 0, 0)
  player.state.vel.set(0, 0, -200)
  player.state.quat.identity()

  enemy.state.pos.set(0, 0, -distance)
  enemy.state.vel.set(0, 0, targetVz)
  enemy.hull = 1e6 // интересует факт попадания, а не смерть
  enemy.shield = 0

  // Ставим пусковую и заряжаем.
  const pylon = hardpointIndices(player.loadout, 'pylon')[0]!
  player.loadout.weapons[pylon] = MISSILE_PYLON
  world.lockedTargetId = enemy.id

  refreshSpec(player)
  const mountIndex = player.spec.mounts.findIndex((m) => m.index === pylon)
  player.guns[mountIndex]!.ammo = 1

  if (!fireMissile(world, player, enemy.id)) {
    console.log(`  ${label} d=${distance} м: ПУСК НЕ СОСТОЯЛСЯ`)
    return
  }

  const hullBefore = enemy.hull
  let t = 0
  while (world.missiles.length > 0 && t < 20) {
    world.time += DT
    t += DT
    player.state.pos.addScaledVector(player.state.vel, DT)
    enemy.state.pos.addScaledVector(enemy.state.vel, DT)
    stepMissiles(world, DT)
  }

  const hit = enemy.hull < hullBefore
  const gap = new Vector3().copy(enemy.state.pos).distanceTo(player.state.pos)
  console.log(
    `  ${label} пуск с ${String(distance).padStart(5)} м -> ${hit ? 'ПОПАЛА' : 'мимо  '} ` +
      `(полёт ${t.toFixed(1)} с, цель теперь в ${gap.toFixed(0)} м)`,
  )
}

console.log(`ракета «${MISSILE_PYLON.name}»: speed=${MISSILE_PYLON.speed} м/с, lifetime=${MISSILE_PYLON.lifetime} с`)
console.log(`теоретический путь ракеты: ${MISSILE_PYLON.speed * MISSILE_PYLON.lifetime} м\n`)

console.log('=== цель УХОДИТ от нас на 200 м/с: догоняем со сближением 220 м/с ===')
for (const d of [1000, 2000, 2500, 3000, 4000]) scenario(d, -200, '')

console.log('\n=== цель ВИСИТ: сближение 420 м/с ===')
for (const d of [2000, 4000, 5000, 6000]) scenario(d, 0, '')

console.log('\n=== цель ЛЕТИТ НАВСТРЕЧУ на 200 м/с: сближение 620 м/с ===')
for (const d of [4000, 5000, 6000, 7000]) scenario(d, 200, '')
