/**
 * Бой без рендера. Если это работает — работает и на сервере.
 */
import { Vector3 } from 'three'
import { aiController } from '../src/domain/ai'
import { createWorld } from '../src/domain/world'
import { stepWorld, type Controller, type ControllerMap } from '../src/domain/sim'
import { steerToward } from '../src/domain/flight'
import { leadPoint } from '../src/domain/ai'
import { peakHeat, missileAmmo } from '../src/domain/combat'
import { itemName } from '../src/domain/cargo'
import type { ShipEntity, World } from '../src/domain/world'

const _aim = new Vector3()
const _fwd = new Vector3()
const _to = new Vector3()

function nearestEnemy(ship: ShipEntity, world: World): ShipEntity | null {
  let best: ShipEntity | null = null
  let bestD = Infinity
  for (const s of world.ships) {
    if (!s.alive) continue
    const d = s.state.pos.distanceToSquared(ship.state.pos)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

/** Тестовый «игрок»: ведёт нос в точку упреждения и жмёт гашетку в узком конусе. */
const dummyPlayer: Controller = {
  update(ship: ShipEntity, world: World) {
    const c = ship.controls
    c.autoBank = true
    c.flightAssist = true

    const enemy = nearestEnemy(ship, world)
    if (!enemy) {
      c.throttle = 0.4
      c.pitch = c.yaw = 0
      return
    }

    leadPoint(ship, enemy, 2000, _aim)
    const st = steerToward(ship.state, _aim, 2.2)
    c.pitch = st.pitch
    c.yaw = st.yaw

    // Не таранить: у самой цели сбрасываем тягу.
    const d = enemy.state.pos.distanceTo(ship.state.pos)
    c.throttle = d < 300 ? 0.35 : 0.85
  },
  wantsFire(ship: ShipEntity, world: World) {
    const enemy = nearestEnemy(ship, world)
    if (!enemy) return false

    const d = enemy.state.pos.distanceTo(ship.state.pos)
    if (d > 1400) return false

    _fwd.set(0, 0, -1).applyQuaternion(ship.state.quat)
    leadPoint(ship, enemy, 2000, _aim)
    _to.copy(_aim).sub(ship.state.pos).normalize()
    return _fwd.dot(_to) > 0.995
  },
}

const world = createWorld()
const controllers: ControllerMap = new Map<number, Controller>([
  [world.player.id, dummyPlayer],
  ...world.ships.map((s) => [s.id, aiController] as [number, Controller]),
])

console.log(`система: ${world.systemName}`)
console.log(`игрок: масса ${world.player.spec.mass} т, тяга ${world.player.spec.tuning.THRUST} кН`)
console.log(`  → ускорение ${(world.player.spec.tuning.THRUST / world.player.spec.mass).toFixed(1)} м/с²`)
console.log(`  → угл. ускорение по тангажу ${world.player.spec.tuning.PITCH_ACCEL.toFixed(2)} рад/с²`)
console.log(`  → потолок скорости ${world.player.spec.tuning.MAX_SPEED.toFixed(0)} м/с`)
console.log(`врагов: ${world.ships.length}, астероидов: ${world.asteroids.length}\n`)

const DT = 1 / 120
const startEnemies = world.ships.length
let maxSpeed = 0

for (let i = 0; i < 120 * 90; i++) {
  stepWorld(world, DT, controllers)
  maxSpeed = Math.max(maxSpeed, world.player.state.vel.length())

  if (i % (120 * 15) === 0) {
    const p = world.player
    const speed = p.state.vel.length()
    // Снос: угол между носом и вектором скорости. Ненулевой => инерция работает.
    const fwd = new Vector3(0, 0, -1).applyQuaternion(p.state.quat)
    const drift = speed > 1 ? Math.acos(Math.max(-1, Math.min(1, fwd.dot(p.state.vel.clone().normalize())))) : 0

    console.log(
      `t=${world.time.toFixed(0).padStart(3)}с  ` +
        `корпус ${p.hull.toFixed(0).padStart(3)} щит ${p.shield.toFixed(0).padStart(3)}  ` +
        `V=${speed.toFixed(0).padStart(3)} м/с  снос ${((drift * 180) / Math.PI).toFixed(0).padStart(2)}°  ` +
        `перегрев ${(peakHeat(p) * 100).toFixed(0).padStart(3)}%  ` +
        `врагов ${world.ships.filter((s) => s.alive).length}  ` +
        `ракет в воздухе ${world.missiles.length}  контейнеров ${world.pods.length}`,
    )
  }
}

const p = world.player
console.log(`\n--- итог за ${world.time.toFixed(0)} с ---`)
console.log(`врагов сбито: ${startEnemies - world.ships.filter((s) => s.alive).length}/${startEnemies}`)
console.log(`игрок ${p.alive ? 'жив' : 'ПОГИБ'}, корпус ${p.hull.toFixed(0)}, очки ${world.score}`)
console.log(`максимальная скорость: ${maxSpeed.toFixed(0)} м/с`)
console.log(`ракет осталось у игрока: ${missileAmmo(p)}`)
console.log(`сдвиг начала координат: ${world.originOffset.length().toFixed(0)} м`)
console.log(`в трюме (${p.hold.capacity} т): ${p.hold.items.map(itemName).join(', ') || 'пусто'}`)
console.log(`контейнеров в космосе: ${world.pods.length}`)
