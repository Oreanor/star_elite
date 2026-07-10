/**
 * Снос при постоянном рыскании: сколько градусов между носом и вектором скорости
 * держит flight assist. Понадобилось, когда удаление автокоординации сдвинуло
 * старый порог теста — надо было понять, физика это или регрессия.
 *
 * Исследование, не тест.
 */
import { Vector3 } from 'three'
import { playerStartLoadout } from '../src/config/loadouts'
import { shipAxes } from '../src/domain/flight/axes'
import { stepShip } from '../src/domain/flight/model'
import { createControls, createShipState } from '../src/domain/flight/types'
import { deriveShipSpec } from '../src/domain/loadout'

const s = createShipState()
const c = createControls()
const t = deriveShipSpec(playerStartLoadout()).tuning
const dt = 1 / 120

c.throttle = 1
for (let i = 0; i < 480; i++) stepShip(s, c, t, dt)

c.yaw = 1
const fwd = new Vector3()
for (let i = 0; i < 600; i++) {
  stepShip(s, c, t, dt)
  if (i % 120 === 0 || i === 599) {
    shipAxes(s.quat, fwd, new Vector3(), new Vector3())
    const drift = (fwd.angleTo(s.vel) * 180) / Math.PI
    console.log(`t=${(i * dt).toFixed(2)}s снос=${drift.toFixed(1)}° |v|=${s.vel.length().toFixed(1)} angVel.y=${s.angVel.y.toFixed(3)}`)
  }
}

console.log(`\nYAW_RATE=${t.YAW_RATE} рад/с, ASSIST_LATERAL_DAMP=${t.ASSIST_LATERAL_DAMP} 1/с`)
const theory = (Math.atan(t.YAW_RATE / t.ASSIST_LATERAL_DAMP) * 180) / Math.PI
console.log(`установившийся снос ≈ atan(ω/k) = ${theory.toFixed(1)}°`)
