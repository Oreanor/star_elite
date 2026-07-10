/**
 * Уводит ли «бочка» от ракеты? Меряем промах, а не ощущение.
 *
 * Здесь виден физический предел. Ракета доворачивает вектор скорости со скоростью
 * `turnRate`, значит её боковое ускорение равно v·ω: при 420 м/с и 1.25 рад/с это
 * 525 м/с², полсотни g. Корабль с боковой тягой 240 кН и массой 15 т выдаёт 16 м/с².
 * От снаряда, который маневреннее тебя в тридцать раз, не уходят манёвром.
 *
 * Спасает не ускорение, а ВРЕМЯ. Наведение у нас — чистая погоня: ракета правит
 * курс на текущее положение цели, и угловая скорость линии визирования растёт
 * как v⊥/d. Значит поздний рывок вбок она отработать не успевает — если успела
 * набраться боковая СКОРОСТЬ. Отсюда два вывода, которые и проверяем:
 *   • лобовую ракету бочкой не увести: до встречи меньше секунды;
 *   • догоняющую — можно, там время есть.
 */
import { Vector3 } from 'three'
import { MISSILE_PYLON, RCS_STANDARD } from '../src/config/modules'
import { fireMissile } from '../src/domain/combat'
import { stepWorld, type Controller, type ControllerMap } from '../src/domain/sim'
import { createWorld, STARTER_SYSTEM, type ShipEntity, type World } from '../src/domain/world'

/** Бочку начинаем, когда ракета вот на такой дистанции. */
const REACT_DISTANCE = 420

const idle: Controller = { update: () => {}, wantsFire: () => false }

/** Ракету несёт только главарь, а главарём становится первый в звене из двух. */
function makeWorld(): World {
  return createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 2, at: [0, 0, -900], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
}

/** Та же бочка, что у игрока: полный оборот, тяга в неподвижную сторону. */
function pilot(barrel: boolean): Controller {
  let angle = -1 // <0 — ещё не начали
  let elapsed = 0

  return {
    update(ship: ShipEntity, world: World, dt: number) {
      const c = ship.controls
      c.throttle = 0.5
      c.flightAssist = true
      c.autoBank = true

      const missile = world.missiles[0]
      if (barrel && angle < 0 && missile && missile.pos.distanceTo(ship.state.pos) < REACT_DISTANCE) {
        angle = 0
      }
      if (angle < 0 || angle >= Math.PI * 2 || elapsed > 3.5) {
        c.roll = 0
        c.strafe = 0
        c.strafeUp = 0
        return
      }

      elapsed += dt
      angle += Math.abs(ship.state.angVel.z) * dt
      c.roll = 1
      c.strafe = Math.cos(angle)
      c.strafeUp = -Math.sin(angle)
    },
    wantsFire: () => false,
  }
}

type Geometry = 'лоб' | 'вдогон'

/** @returns [попала ли, боковой снос] */
function run(barrel: boolean, geometry: Geometry): [boolean, number] {
  const world = makeWorld()
  const enemy = world.ships[0]!
  const player = world.player
  const controllers: ControllerMap = new Map<number, Controller>([
    [player.id, pilot(barrel)],
    ...world.ships.map((s) => [s.id, idle] as [number, Controller]),
  ])

  if (geometry === 'лоб') {
    // Враг впереди, носом на игрока: сближение под 600 м/с.
    enemy.state.quat.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
  } else {
    // Враг за кормой и смотрит игроку вслед.
    enemy.state.pos.set(0, 0, 900)
    enemy.state.quat.identity()
  }
  if (!fireMissile(world, enemy, player.id)) throw new Error('главарь без ракеты')

  const start = player.state.pos.clone()
  const before = player.hull + player.shield
  for (let i = 0; i < 120 * 20 && world.missiles.length > 0; i++) stepWorld(world, 1 / 120, controllers)

  const drift = player.state.pos.clone().sub(start)
  return [player.hull + player.shield < before, Math.hypot(drift.x, drift.y)]
}

console.log('боковая тяга × предел слежения ГСН   →   без бочки / с бочкой (снос)\n')
for (const geometry of ['лоб', 'вдогон'] as const) {
  console.log(`── ${geometry} ──`)
  for (const lateral of [170, 240, 340]) {
    RCS_STANDARD.lateralThrust = lateral
    for (const seeker of [1.2, 0.7, 0.5, 0.35, 0.25]) {
      MISSILE_PYLON.seekerRate = seeker
      const [plainHit] = run(false, geometry)
      const [rolledHit, drift] = run(true, geometry)
      const good = plainHit && !rolledHit ? '  ← то, что нужно' : ''
      console.log(
        `${String(lateral).padStart(4)} кН × ${seeker.toFixed(2)} рад/с   →   ` +
          `${plainHit ? 'попала' : 'промах'} / ${rolledHit ? 'попала' : 'промах'} ` +
          `(снос ${drift.toFixed(0)} м)${good}`,
      )
    }
  }
  console.log()
}
