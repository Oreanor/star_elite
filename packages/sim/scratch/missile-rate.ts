/**
 * Сколько ракет бот пускает за 20 секунд боя — и зависит ли это от частоты шага.
 * Если зависит, значит вероятность задана «за шаг», а не «за секунду».
 */
import { Vector3 } from 'three'
import { aiController } from '../src/domain/ai'
import { createWorld, STARTER_SYSTEM } from '../src/domain/world'
import { stepWorld, type Controller, type ControllerMap } from '../src/domain/sim'
import { pirateLeaderLoadout } from '../src/config/loadouts'
import { makeShip } from '../src/domain/world/factory'
import { createAIState } from '../src/domain/ai/types'
import { Quaternion } from 'three'

function run(hz: number) {
  const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })

  const leader = makeShip(
    world.ids,
    'hostile',
    'Главарь',
    pirateLeaderLoadout(),
    new Vector3(0, 0, -800),
    new Quaternion(),
  )
  leader.ai = createAIState(leader.state.pos, world.rng)
  world.ships.push(leader)

  const dummy: Controller = {
    update: (ship) => {
      ship.controls.throttle = 0.4
    },
    wantsFire: () => false,
  }
  const controllers: ControllerMap = new Map<number, Controller>([
    [world.player.id, dummy],
    [leader.id, aiController],
  ])

  let launched = 0
  let seen = new Set<number>()

  const dt = 1 / hz
  for (let i = 0; i < hz * 20; i++) {
    stepWorld(world, dt, controllers)
    for (const m of world.missiles) {
      if (!seen.has(m.id)) {
        seen.add(m.id)
        launched++
      }
    }
  }

  return { launched, hull: world.player.hull, shield: world.player.shield, alive: world.player.alive }
}

console.log('шаг     ракет за 20 с   игрок после боя')
console.log('─'.repeat(52))
for (const hz of [60, 120, 240]) {
  const r = run(hz)
  console.log(
    `${String(hz).padStart(3)} Гц   ${String(r.launched).padStart(6)}          ` +
      `корпус ${r.hull.toFixed(0).padStart(3)} щит ${r.shield.toFixed(0).padStart(3)} ${r.alive ? '' : 'ПОГИБ'}`,
  )
}
console.log('\nЕсли числа растут с частотой — вероятность задана за ШАГ, а не за секунду.')
