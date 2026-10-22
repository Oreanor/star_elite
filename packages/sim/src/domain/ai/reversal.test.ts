import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { stepWorld } from '../sim'
import { shipAxes } from '../flight/axes'
import { engageAutofight } from './autofight'
import { aiController } from './pilot'
import { lockContact } from '../world/queries'

/**
 * РАЗВОРОТ ВТОРОГО ПИЛОТА. Просили: автобой пусть умеет фигуры, хотя бы SS, когда противник
 * проскочил за спину. Фигура та же, что у игрока (`aerobatics.ts`), — проверяем не число, а
 * свойство: с ней нос находит цель за спиной быстрее, чем обычным виражом того же корпуса.
 */

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _to = new Vector3()

function behind(aerobatics: boolean): World {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, 0], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  const p = world.player
  if (!aerobatics) p.loadout = { ...p.loadout, chassis: { ...p.loadout.chassis, aerobatics: false } }
  shipAxes(p.state.quat, _fwd, _right, _up)
  // Проскочил за спину и чуть выше: 700 м позади.
  const pirate = world.ships[0]!
  pirate.state.pos.copy(p.state.pos).addScaledVector(_fwd, -700).addScaledVector(_up, 60)
  pirate.state.vel.set(0, 0, 0)
  p.state.vel.copy(_fwd).multiplyScalar(150)
  lockContact(world, 'ship', pirate.id)
  world.targetFocus = 'contact'
  expect(engageAutofight(world)).toBe(true)
  return world
}

/** Секунды, пока нос не встанет на цель в пределах 15°, и была ли фигура. */
function timeToFace(world: World): { t: number; figure: boolean } {
  const controllers = new Map([[world.player.id, aiController]])
  const pirate = world.ships[0]!
  let figure = false
  for (let i = 0; i < 60 * 12; i++) {
    stepWorld(world, 1 / 60, controllers)
    if (world.player.ai?.manoeuvre.kind === 'reversal') figure = true
    shipAxes(world.player.state.quat, _fwd, _right, _up)
    _to.copy(pirate.state.pos).sub(world.player.state.pos).normalize()
    if (_fwd.dot(_to) > Math.cos((15 * Math.PI) / 180)) return { t: i / 60, figure }
  }
  return { t: Infinity, figure }
}

describe('разворот в бою', () => {
  it('цель за спиной — второй пилот крутит разворот и находит её быстрее виража', () => {
    const withFigure = timeToFace(behind(true))
    const plain = timeToFace(behind(false))
    expect(withFigure.figure).toBe(true)
    expect(plain.figure).toBe(false)
    expect(withFigure.t).toBeLessThan(plain.t)
  })
})
