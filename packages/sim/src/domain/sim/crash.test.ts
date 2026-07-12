import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { DOCKING } from '../../config/station'
import { createWorld, STARTER_SYSTEM, type BodyEntity, type World } from '../world'
import { stepWorld } from './step'

/**
 * Удар о твердь.
 *
 * Планета не «наносит урон» — она кончает полёт: щита от коры не бывает.
 * Станция бьёт по корпусу, но не убивает: об неё ЗАДЕВАЮТ. Порог у неё ровно
 * тот же, по которому она принимает швартовку, и второго правила тут быть не
 * может — иначе однажды окажется, что стыковаться можно только тараня.
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
  it('корабль, дошедший до поверхности планеты, гибнет', () => {
    const world = quiet()
    ram(world, bodyOf(world, 'planet'), 40)

    oneStep(world)

    expect(world.player.alive).toBe(false)
  })

  /** Щит держит лучи и обломки, а не кору: полный щит от планеты не спасает. */
  it('полный щит не спасает от планеты', () => {
    const world = quiet()
    const player = world.player
    player.shield = player.spec.hull.shield
    ram(world, bodyOf(world, 'planet'), 5)

    oneStep(world)

    expect(player.alive).toBe(false)
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
})
