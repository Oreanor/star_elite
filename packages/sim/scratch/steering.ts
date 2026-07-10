/**
 * «Зря подкручивает и мотает»: крутится ли корабль сам.
 *
 * После удаления автокоординации физика вращения не знает мировой оси.
 * Этот прогон показывает три вещи глазами:
 *   1. дрейф носа при почти нулевой ручке (мёртвая зона живёт в контроллере,
 *      сюда controls приходят уже очищенными — поэтому здесь видно СЫРУЮ модель);
 *   2. что рыскание больше не порождает крена;
 *   3. что отпущенная ручка не выравнивает корабль.
 *
 * Исследование, не тест.
 */
import { Quaternion, Vector3 } from 'three'
import { PHYSICS } from '../src/config/physics'
import { stepShip } from '../src/domain/flight/model'
import { createWorld } from '../src/domain/world'

const DT = PHYSICS.FIXED_DT
const deg = (r: number) => (r * 180) / Math.PI

/** Крен относительно мировой Y — МЕРА для глаз. Физика этой оси не знает. */
function bank(q: Quaternion): number {
  const right = new Vector3(1, 0, 0).applyQuaternion(q)
  const up = new Vector3(0, 1, 0).applyQuaternion(q)
  return Math.atan2(right.dot(new Vector3(0, 1, 0)), up.dot(new Vector3(0, 1, 0)))
}

function fresh() {
  const ship = createWorld().player
  ship.state.vel.set(0, 0, -200)
  ship.state.angVel.set(0, 0, 0)
  Object.assign(ship.controls, {
    throttle: 0.5,
    pitch: 0,
    yaw: 0,
    roll: 0,
    rudder: 0,
    strafe: 0,
    strafeUp: 0,
    flightAssist: true,
    boost: 1,
    cruise: 1,
    retro: 0,
  })
  return ship
}

const _fwd = new Vector3()
const nose = (ship: ReturnType<typeof fresh>) => _fwd.set(0, 0, -1).applyQuaternion(ship.state.quat).clone()

console.log('=== дрейф носа за 60 с при заданном отклонении ручки (без мёртвой зоны) ===')
for (const stick of [0, 0.001, 0.005, 0.02]) {
  const ship = fresh()
  const start = nose(ship)
  ship.controls.yaw = stick
  for (let i = 0; i < 60 / DT; i++) stepShip(ship.state, ship.controls, ship.spec.tuning, DT)
  console.log(`  ручка ${stick.toFixed(3)} -> нос ушёл на ${deg(Math.acos(Math.min(1, start.dot(nose(ship))))).toFixed(1)}°`)
}

console.log('\n=== крен при постоянном рыскании (yaw=1) ===')
{
  const ship = fresh()
  ship.controls.yaw = 1
  for (let second = 1; second <= 4; second++) {
    for (let i = 0; i < 1 / DT; i++) stepShip(ship.state, ship.controls, ship.spec.tuning, DT)
    console.log(`  t=${second}s крен ${deg(bank(ship.state.quat)).toFixed(2)}°  (рыскание крен не наводит)`)
  }
}

console.log('\n=== ручка отпущена, корабль накренён ===')
{
  const ship = fresh()
  ship.controls.roll = 1
  while (Math.abs(deg(bank(ship.state.quat))) < 40) stepShip(ship.state, ship.controls, ship.spec.tuning, DT)
  ship.controls.roll = 0

  for (const t of [1, 2, 4]) {
    for (let i = 0; i < 1 / DT; i++) stepShip(ship.state, ship.controls, ship.spec.tuning, DT)
    console.log(`  t=${t}s крен ${deg(bank(ship.state.quat)).toFixed(1)}° angVel.z=${ship.state.angVel.z.toFixed(4)}`)
  }
  console.log('  ^ крен замер там, где его оставили. Мировой оси у физики нет.')
}
