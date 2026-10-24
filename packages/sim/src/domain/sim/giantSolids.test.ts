import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { systemDefFor } from '../galaxy/jump'
import { createWorld, enterSystem } from '../world/index'
import type { World } from '../world/entities'
import { stepWorld } from './step'
import { apparentRadius, effectiveRadius } from '../scale/scale'
import { clearBodiesOnResize } from '../scale/resizeClear'

/**
 * Твердь для выросшего борта. Тела ужимаются с ростом (закон зума), а корпус растёт: на ×1000
 * база в 3 км для пилота — точка в 3 м, а корпус — сфера в 12 км. Пойманное: такая невидимая
 * точка отбрасывала гиганта целиком («что-то невидимое сталкивает»).
 */
function worldWithBase(): World {
  let index = 1
  while ((systemDefFor(index, GALAXY.SEED).warBases ?? []).length < 1) index++
  const def = { ...systemDefFor(index, GALAXY.SEED), patrols: [] }
  const world = createWorld({ ...def, belt: null })
  enterSystem(world, def, index)
  return world
}

describe('твердь для выросшего борта', () => {
  it('ужатая база, крохотная против корпуса, гиганта не отбрасывает — он проходит', () => {
    const world = worldWithBase()
    const base = world.warBases[0]!
    const p = world.player
    p.state.scale = 1000
    // Летим прямо на базу: в упор, её видимая сфера (R/1000) — точка внутри корпуса.
    p.state.pos.copy(base.pos).add(new Vector3(0, 0, 3_000))
    p.state.vel.set(0, 0, -200)
    const crashBefore = p.lastHullHitAt
    stepWorld(world, 1 / 60, new Map())
    expect(p.state.vel.z).toBeLessThan(0) // не отскочил назад
    expect(p.lastHullHitAt).toBe(crashBefore)
  })

  it('на ×1 та же база твёрдая, как была', () => {
    const world = worldWithBase()
    const base = world.warBases[0]!
    const p = world.player
    p.state.pos.copy(base.pos).add(new Vector3(0, 0, base.radius + 5))
    p.state.vel.set(0, 0, -200)
    stepWorld(world, 1 / 60, new Map())
    expect(p.state.pos.distanceTo(base.pos)).toBeGreaterThan(base.radius * 0.9)
  })
})

describe('смена роста у тела', () => {
  it('сжался у звезды — её поверхность не наезжает ударом: корабль вытолкнут наружу, цел', () => {
    // Пойманное: у звезды на ×1000 (парковка автопилота — пара её видимых радиусов) пилот
    // уменьшался, видимая звезда росла быстрее, чем он к ней «приближался», и поверхность
    // наезжала — удар о звезду, до которой он не долетал.
    const world = worldWithBase()
    const p = world.player
    const star = world.bodies.find((b) => b.kind === 'star')!
    const dir = p.state.pos.clone().sub(star.pos).normalize()
    p.state.scale = 1000
    p.state.pos.copy(star.pos).addScaledVector(dir, 2 * apparentRadius(star.radius, true, 1000))
    p.state.vel.set(0, 0, 0)
    p.state.scale = 100 // сжался: звезда для него в 10 раз больше
    clearBodiesOnResize(world, p)
    const gap = p.state.pos.distanceTo(star.pos) - apparentRadius(star.radius, true, 100) - effectiveRadius(p)
    expect(gap).toBeGreaterThan(0)
    const hull = p.hull
    const crash = p.lastHullHitAt
    stepWorld(world, 1 / 60, new Map())
    expect(p.hull).toBe(hull)
    expect(p.lastHullHitAt).toBe(crash)
  })
})
