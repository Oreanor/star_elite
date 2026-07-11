/**
 * Догоняем ли контейнеры.
 *
 * Раньше контейнер уносил ВСЮ скорость обломка, и пират под форсажем уходил
 * быстрее, чем «Аврора» вообще способна лететь: трофей был недостижим в принципе.
 *
 * Критерий достижимости — не относительная скорость в момент гибели (игрок ещё
 * на боевом ходу и пролетает мимо; сбросить газ он всегда успеет), а СКОРОСТЬ
 * САМОГО КОНТЕЙНЕРА против потолка корабля. Медленнее потолка — догоню.
 *
 * Исследование, не тест.
 */
import { SALVAGE } from '../src/config/weapons'
import { spawnWreckage } from '../src/domain/combat/salvage'
import { createWorld, STARTER_SYSTEM } from '../src/domain/world'

const world = createWorld({ ...STARTER_SYSTEM, belt: null })
const player = world.player
const pirate = world.ships[0]!

// Пират уходит от игрока на боевом ходу — обычное дело в момент гибели.
player.state.vel.set(0, 0, -180)
pirate.state.vel.set(0, 0, -260)

spawnWreckage(world, pirate)

const ceiling = player.spec.tuning.MAX_SPEED
console.log(`порог захвата: ${SALVAGE.SCOOP_MAX_REL_SPEED} м/с`)
console.log(`предельная скорость «Авроры»: ${ceiling.toFixed(0)} м/с`)
console.log(`скорость обломка: ${pirate.state.vel.length().toFixed(0)} м/с, наследуется доля ${SALVAGE.POD_VELOCITY_INHERIT}\n`)

let unreachable = 0
for (const pod of world.pods) {
  const speed = pod.vel.length()
  const gone = speed >= ceiling
  if (gone) unreachable++
  console.log(
    `  ${String(pod.item.kind).padEnd(9)} |v|=${speed.toFixed(0).padStart(3)} м/с  ` +
      `запас хода ${(ceiling - speed).toFixed(0).padStart(3)} м/с  ${gone ? '← НЕ ДОГНАТЬ' : 'догоню'}`,
  )
}

console.log(`\nне догнать: ${unreachable} из ${world.pods.length}`)
console.log(`догнав, надо ещё уравнять скорость: порог подбора ${SALVAGE.SCOOP_MAX_REL_SPEED} м/с,`)
console.log(`и это делает тяговый луч (C), а не пилот вручную.`)
