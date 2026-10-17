import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { PHYSICS } from '../../config/physics'
import { systemDefFor } from '../galaxy/jump'
import { SHARED_START_INDEX } from '../galaxy/sharedStart'
import { armAutoland } from '../flight/landing'
import { effectiveRadius } from '../scale/scale'
import { stepWorld } from '../sim'
import { createWorld, type World } from '.'
import { quietWorld } from '../../testkit'

/**
 * ПРАВИЛО КАМЕРЫ. Камера живёт в мировых координатах и знает о переносах мира только через
 * `originShift`. Значит за каждый такт: смещение игрока − originShift = его СОБСТВЕННЫЙ ход
 * (≈ скорость × dt). Нарушение видно как «корабль убегает/дёргается/камера уехала».
 *
 * Этот класс багов ловился порознь четыре раза: перенос с опорой у станции, вращение планеты
 * под ховером, спуск у пола, перецентровка начала. Здесь — одно правило на все сценарии.
 */
function assertCameraKnows(world: World, steps: number, mutate: (w: World, i: number) => void, label: string): void {
  const p = world.player
  const dt = PHYSICS.FIXED_DT
  let worst = 0
  for (let i = 0; i < steps; i++) {
    mutate(world, i)
    const pos = p.state.pos.clone()
    const v0 = p.state.vel.clone()
    stepWorld(world, dt, new Map())
    const own = v0.add(p.state.vel).multiplyScalar(0.5 * dt)
    const unexplained = p.state.pos.clone().sub(pos).sub(world.originShift).sub(own).length()
    worst = Math.max(worst, unexplained)
  }
  // Полметра за такт — с запасом на поворот скорости и рельс высоты; прежние баги давали метры.
  expect(worst, label).toBeLessThan(0.5)
}

function hoverOver(world: World, kind: 'planet' | 'moon'): void {
  const body = world.bodies.find((b) => b.kind === kind)!
  const p = world.player
  p.state.pos.copy(body.pos).add(new Vector3(body.radius + effectiveRadius(p) + 500, 0, 0))
  p.state.vel.set(0, 0, 0)
  p.controls.throttle = 0
  if (!armAutoland(world)) throw new Error('не в окне посадки')
}

describe('камера знает обо всех переносах мира', () => {
  it('полёт у станции, едущей по орбите', () => {
    const world = createWorld({ ...systemDefFor(SHARED_START_INDEX, GALAXY.SEED), patrols: [], belt: null })
    const station = world.bodies.find((b) => b.kind === 'station')!
    world.player.state.pos.copy(station.pos).add(new Vector3(0, 0, station.radius * 3))
    assertCameraKnows(world, 600, (w) => { w.player.controls.throttle = 1; w.player.controls.yaw = 0.3 }, 'у станции')
  })

  it('ховер над вращающейся планетой: газ, рыскание, тангаж', () => {
    const world = quietWorld()
    hoverOver(world, 'planet')
    assertCameraKnows(world, 900, (w, i) => {
      const c = w.player.controls
      c.throttle = 1
      c.yaw = Math.sin(i / 60)
      c.pitch = 0.4 * Math.cos(i / 90)
    }, 'ховер')
  })

  it('ховер: Shift+W/S до потолка и пола', () => {
    const world = quietWorld()
    hoverOver(world, 'moon')
    assertCameraKnows(world, 2400, (w, i) => { w.player.controls.strafeUp = i < 1200 ? -1 : 1 }, 'эшелон')
    expect(world.player.landedOn).not.toBeNull()
  })

  it('долгий полёт через перецентровку начала координат', () => {
    const world = quietWorld()
    world.player.state.pos.set(30_000, 0, 0)
    assertCameraKnows(world, 1200, (w) => { w.player.controls.throttle = 1; w.player.controls.boost = 2 }, 'перецентровка')
  })
})
