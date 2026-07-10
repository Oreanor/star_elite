/**
 * «Невидимая стена»: лечу от станции вдоль планеты и ищу, что дёргает корабль.
 *
 * Печатает каждый скачок скорости, каждый сдвиг начала координат и расстояние
 * до ближайшего астероида в этот момент. Исследование, не тест.
 */
import { Vector3 } from 'three'
import { PHYSICS } from '../src/config/physics'
import { stepWorld } from '../src/domain/sim'
import { createWorld } from '../src/domain/world'

const world = createWorld()
const player = world.player

// Летим «вдоль планеты»: касательно к поверхности, полный ход, без крейсера.
player.controls.throttle = 1
player.controls.cruise = 1

const prevVel = new Vector3().copy(player.state.vel)
const truePos = new Vector3()

let shifts = 0
let jumps = 0

const DT = 1 / 60
const STEPS = 60 * 60 // одна минута

for (let i = 0; i < STEPS; i++) {
  const before = player.state.vel.length()
  stepWorld(world, DT, new Map())
  const after = player.state.vel.length()

  const t = (i * DT).toFixed(2)
  truePos.copy(player.state.pos).add(world.originOffset)

  if (world.originShift.lengthSq() > 0) {
    shifts++
    console.log(
      `t=${t}s СДВИГ на ${world.originShift.length().toFixed(0)} м; ` +
        `|v|=${after.toFixed(1)} м/с; pos=${player.state.pos.length().toFixed(1)}`,
    )
  }

  // Скачок скорости: интегратор за шаг не меняет её больше, чем на a·dt.
  const dv = Math.abs(after - before)
  if (dv > 2) {
    jumps++
    let nearest = Infinity
    for (const a of world.asteroids) {
      const d = a.pos.distanceTo(player.state.pos) - a.radius - player.spec.hull.radius
      if (d < nearest) nearest = d
    }
    console.log(
      `t=${t}s СКАЧОК |v|: ${before.toFixed(1)} -> ${after.toFixed(1)} (Δ${dv.toFixed(1)}); ` +
        `до астероида ${nearest.toFixed(1)} м; hull=${player.hull.toFixed(0)} shield=${player.shield.toFixed(0)}`,
    )
  }
  prevVel.copy(player.state.vel)
}

const planet = world.bodies.find((b) => b.kind === 'planet')!
const altitude = planet.pos.distanceTo(player.state.pos) - planet.radius

console.log(
  `\nитог: сдвигов=${shifts} скачков=${jumps} |v|=${player.state.vel.length().toFixed(1)} ` +
    `высота=${(altitude / 1000).toFixed(1)} км cruise=${player.cruise.factor.toFixed(3)} ` +
    `FLOATING_ORIGIN_RADIUS=${PHYSICS.FLOATING_ORIGIN_RADIUS}`,
)
