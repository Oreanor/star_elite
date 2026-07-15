import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { DOCKING } from '../../config/station'
import { shipAxes } from '../flight/axes'
import { createWorld, STARTER_SYSTEM, type BodyEntity, type World } from '../world'
import { stepWorld } from './step'

/**
 * Контакт с крупным телом.
 *
 * Планета и луна принимают посадку, звезда сжигает, чёрная дыра проходима.
 * У станции остаётся защитное поле: оно не относится к гравитации поверхности.
 */

const NO_CONTROLLERS = new Map()

/**
 * РОВНО один шаг физики. Кадр в 1/60 содержит их два, и корабль, застрявший в
 * коре, погибал бы от второго удара даже с щитом, который его от первого спас.
 * Тест обязан видеть один удар, иначе он не различает «щит не помог» и
 * «щит помог, но ненадолго».
 */
const oneStep = (world: World) => stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)

function quiet(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

function bodyOf(world: World, kind: BodyEntity['kind']): BodyEntity {
  const body = world.bodies.find((b) => b.kind === kind)
  if (!body) throw new Error(`в мире нет тела «${kind}»`)
  return body
}

/** Ставит корабль вплотную к телу и даёт ему скорость внутрь. */
function ram(world: World, body: BodyEntity, speed: number): void {
  const player = world.player
  player.state.pos.copy(body.pos)
  player.state.pos.x += body.radius + player.spec.hull.radius - 1
  player.state.vel.set(-speed, 0, 0)
  player.controls.throttle = 0
}

describe('удар о крупное тело', () => {
  it('любая скорость касания планеты заканчивается посадкой без гибели', () => {
    const world = quiet()
    const planet = bodyOf(world, 'planet')
    ram(world, planet, 4_000)

    oneStep(world)

    expect(world.player.alive).toBe(true)
    expect(world.player.landedOn?.bodyId).toBe(planet.id)
    expect(world.player.state.vel.length()).toBe(0)
  })

  it('посадка не тратит щит или корпус', () => {
    const world = quiet()
    const player = world.player
    player.shield = player.spec.hull.shield
    const before = player.shield + player.hull
    ram(world, bodyOf(world, 'planet'), 500)

    oneStep(world)

    expect(player.shield + player.hull).toBe(before)
  })

  /**
   * В станцию врезаться НЕЛЬЗЯ: у поверхности защитное поле. Оно не бьёт по корпусу —
   * станция неуязвима и невредима для тебя, — а упруго отталкивает. Даже на тихой
   * скорости корабль отпружинивает, а не проходит внутрь к причалу (стыковка — по L).
   */
  it('поле станции не бьёт по корпусу — отталкивает без урона', () => {
    const world = quiet()
    const player = world.player
    ram(world, bodyOf(world, 'station'), DOCKING.MAX_SPEED - 5)
    const before = player.hull + player.shield

    oneStep(world)

    expect(player.alive).toBe(true)
    expect(player.hull + player.shield).toBe(before)
  })

  /**
   * Разогнавшийся не таранит станцию, а отпружинивает от поля назад, ТЕРЯЯ ход, и без
   * урона корпусу. Проверяется отскок и целость, а не числа. Вспышка поля рождается.
   */
  it('на скорости корабль отпружинивает от поля без урона', () => {
    const world = quiet()
    const player = world.player
    const station = bodyOf(world, 'station')
    ram(world, station, DOCKING.MAX_SPEED * 4)
    const before = player.hull + player.shield

    oneStep(world)

    // Поле не наносит урон: станция неуязвима, но и корабль о неё не бьётся.
    expect(player.hull + player.shield).toBe(before)
    // Скорость сменила знак: корабль уходит ОТ станции, а не сквозь неё.
    expect(player.state.vel.x).toBeGreaterThan(0)
    // И не провалился внутрь поля.
    expect(player.state.pos.distanceTo(station.pos)).toBeGreaterThanOrEqual(station.radius)
    // Удар о поле зажёг вспышку.
    expect(world.shieldFlashes.length).toBeGreaterThan(0)
  })

  it('станция не убивает: от поля отскакивают, а не разбиваются насмерть', () => {
    const world = quiet()
    ram(world, bodyOf(world, 'station'), DOCKING.MAX_SPEED * 4)

    oneStep(world)

    expect(world.player.alive).toBe(true)
  })

  it('выросший миелофоном корабль тоже садится, а не отскакивает', () => {
    const world = quiet()
    const player = world.player
    player.state.scale = 40
    const planet = bodyOf(world, 'planet')
    ram(world, planet, 40)

    oneStep(world)

    expect(player.alive).toBe(true)
    expect(player.landedOn?.bodyId).toBe(planet.id)
  })

  it('посаженный корпус лежит в плоскости, перпендикулярной радиусу', () => {
    const world = quiet()
    const player = world.player
    const planet = bodyOf(world, 'planet')
    ram(world, planet, 40)

    oneStep(world)

    const normal = player.state.pos.clone().sub(planet.pos).normalize()
    const forward = new Vector3()
    const right = new Vector3()
    const up = new Vector3()
    shipAxes(player.state.quat, forward, right, up)
    expect(up.dot(normal)).toBeCloseTo(1, 6)
    expect(Math.abs(forward.dot(normal))).toBeLessThan(1e-6)
  })

  it('новая тяга немедленно отрывает корабль от поверхности', () => {
    const world = quiet()
    const player = world.player
    const planet = bodyOf(world, 'planet')
    ram(world, planet, 40)
    oneStep(world)

    player.controls.throttle = 0.2
    oneStep(world)

    expect(player.landedOn).toBeNull()
    expect(player.state.vel.dot(player.state.pos.clone().sub(planet.pos).normalize())).toBeGreaterThan(0)
  })

  it('касание звезды сжигает без отскока', () => {
    const world = quiet()
    const player = world.player
    const star = bodyOf(world, 'star')
    ram(world, star, 40)

    oneStep(world)

    expect(player.alive).toBe(false)
    expect(player.hullHeat).toBe(1)
    expect(player.state.vel.x).toBeLessThanOrEqual(0)
  })

  it('чёрная дыра не имеет твёрдой сферы и пропускает центр', () => {
    const world = quiet()
    const player = world.player
    const hole = bodyOf(world, 'star')
    hole.kind = 'blackhole'
    player.state.pos.copy(hole.pos)
    player.state.vel.set(0, 0, 0)
    player.controls.throttle = 0

    oneStep(world)

    expect(player.alive).toBe(true)
    expect(player.landedOn).toBeNull()
  })
})
