import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { CRUISE } from '../../config/cruise'
import { LANDING } from '../../config/landing'
import { MIELOPHONE } from '../../config/mielophone'
import { PHYSICS } from '../../config/physics'
import { DOCKING } from '../../config/station'
import { shipAxes } from '../flight/axes'
import { armAutoland, releaseLanding } from '../flight/landing'
import { createWorld, STARTER_SYSTEM, type BodyEntity, type World } from '../world'
import { stepWorld } from './step'

/**
 * Контакт с крупным телом.
 *
 * У планеты, луны, статуи и глыбы ТВЁРДАЯ поверхность: неуправляемое касание
 * отбрасывает назад без урона (жёлтый «КРУШЕНИЕ»), сесть — только автопосадкой
 * (L в окне высот). Звезда сжигает, чёрная дыра проходима. У станции — поле.
 */

const NO_CONTROLLERS = new Map()

/**
 * РОВНО один шаг физики. Кадр в 1/60 содержит их два, и корабль, застрявший в
 * коре, ловил бы второй удар. Тест обязан видеть один контакт.
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

/** Ставит корабль в неподвижное зависание на заданной высоте над телом (в окне автопосадки). */
function hover(world: World, body: BodyEntity, altitude: number): void {
  const player = world.player
  player.state.pos.copy(body.pos)
  player.state.pos.x += body.radius + player.spec.hull.radius * player.state.scale + altitude
  player.state.vel.set(0, 0, 0)
  player.controls.throttle = 0
}

/** Заводит непрерываемую автопосадку из окна высот и крутит шаги, пока корабль не сядет. */
function landViaAutoland(world: World, body: BodyEntity): void {
  hover(world, body, LANDING.HOVER_ALT)
  if (!armAutoland(world)) throw new Error('автопосадка не завелась — корабль не в окне высот')
  for (let i = 0; i < 3000 && !world.player.landedOn; i++) oneStep(world)
}

describe('удар о крупное тело', () => {
  it('неуправляемое касание планеты отбрасывает без урона — поверхность твёрдая', () => {
    const world = quiet()
    const player = world.player
    const planet = bodyOf(world, 'planet')
    const before = player.hull + player.shield
    ram(world, planet, 4_000)

    oneStep(world)

    expect(player.alive).toBe(true)
    expect(player.hull + player.shield).toBe(before)
    expect(player.landedOn).toBeNull()
    // Уходит ОТ планеты, а не сквозь неё.
    expect(player.state.vel.x).toBeGreaterThan(0)
    expect(player.state.pos.distanceTo(planet.pos)).toBeGreaterThanOrEqual(planet.radius)
    expect(player.lastCrashAt).toBe(world.time)
    expect(player.lastCrashHit).toEqual({ kind: 'planet', name: planet.name })
  })

  /**
   * РЕГРЕССИЯ. На полном крейсере шаг — десятки тысяч км; точечная проверка и
   * `isPhased → skip` пропускали целую планету между кадрами — «всегда пролетаю
   * насквозь». Заметание ловит пересечение; отскок гасит крейсер и ставит
   * на сторону подхода.
   */
  it('крейсер не прошивает планету насквозь за один шаг', () => {
    const world = quiet()
    const player = world.player
    const planet = bodyOf(world, 'planet')
    const jump = planet.radius * 4
    player.state.pos.copy(planet.pos).setX(planet.pos.x - planet.radius - 1_000)
    player.state.vel.set(jump / PHYSICS.FIXED_DT, 0, 0)
    player.cruise.factor = CRUISE.MAX_FACTOR
    player.controls.throttle = 0

    oneStep(world)

    expect(player.alive).toBe(true)
    expect(player.cruise.factor).toBe(1)
    expect(player.state.vel.length()).toBeLessThanOrEqual(LANDING.CRASH_BOUNCE_MAX + 1e-6)
    // После отскока — снаружи, на стороне подхода (отрицательный X от центра).
    expect(player.state.pos.x).toBeLessThan(planet.pos.x)
  })

  it('автопосадка сажает без урона щиту и корпусу', () => {
    const world = quiet()
    const player = world.player
    player.shield = player.spec.hull.shield
    const before = player.shield + player.hull
    const planet = bodyOf(world, 'planet')

    landViaAutoland(world, planet)

    expect(player.alive).toBe(true)
    expect(player.landedOn?.bodyId).toBe(planet.id)
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

  it('выросший миелофоном корабль НЕ проваливается — касание считается по раздутому габариту', () => {
    const world = quiet()
    const player = world.player
    player.state.scale = 40
    const planet = bodyOf(world, 'planet')
    ram(world, planet, 40)

    oneStep(world)

    // Столкновение считается по effectiveRadius: гигант не сквозит сквозь планету —
    // отскакивает, как обычный корабль, и метит крушение для пуша.
    expect(player.alive).toBe(true)
    expect(player.lastCrashAt).toBe(world.time)
    expect(player.lastCrashHit).toEqual({ kind: 'planet', name: planet.name })
    expect(player.state.pos.distanceTo(planet.pos)).toBeGreaterThanOrEqual(
      planet.radius + player.spec.hull.radius * player.state.scale - 1,
    )
  })

  it('автопосаженный корпус лежит в плоскости, перпендикулярной радиусу', () => {
    const world = quiet()
    const player = world.player
    const planet = bodyOf(world, 'planet')

    landViaAutoland(world, planet)

    const normal = player.state.pos.clone().sub(planet.pos).normalize()
    const forward = new Vector3()
    const right = new Vector3()
    const up = new Vector3()
    shipAxes(player.state.quat, forward, right, up)
    expect(up.dot(normal)).toBeCloseTo(1, 6)
    expect(Math.abs(forward.dot(normal))).toBeLessThan(1e-6)
  })

  it('L отпускает стоянку без телепорта', () => {
    const world = quiet()
    const player = world.player
    const planet = bodyOf(world, 'planet')
    landViaAutoland(world, planet)
    const before = player.state.pos.clone()

    expect(releaseLanding(player, world)).toBe(true)
    expect(player.landedOn).toBeNull()
    expect(player.state.pos.distanceTo(before)).toBeLessThan(1)
  })

  /**
   * Игрок не уходит в Game Over: касание звезды — отскок, полные щиты/корпус и
   * красный «корабль потерян · звезда …». Боты по-прежнему сгорают.
   */
  it('касание звезды у игрока — потерян с причиной, игра дальше', () => {
    const world = quiet()
    const player = world.player
    const star = bodyOf(world, 'star')
    ram(world, star, 40)

    oneStep(world)

    expect(player.alive).toBe(true)
    expect(player.hull).toBe(player.spec.hull.hull)
    expect(player.shield).toBe(player.spec.hull.shield)
    expect(player.lastLostAt).toBe(world.time)
    expect(player.lastLostHit).toEqual({ kind: 'star', name: star.name })
    expect(player.state.vel.x).toBeGreaterThan(0)
  })

  it('с ×50 касание астероида не даёт крушения', () => {
    const world = createWorld({
      ...STARTER_SYSTEM,
      patrols: [],
      belt: { count: 1, radius: 500, spread: 50, center: [200, 0, 0] },
    })
    const player = world.player
    const rock = world.asteroids[0]!
    // count:1 в фабрике раздувает камень до колосса (нав). Жмём обратно в мелочь.
    rock.radius = 8
    player.state.scale = 2
    player.state.pos.copy(rock.pos)
    player.state.pos.x += rock.radius + player.spec.hull.radius - 1
    player.state.vel.set(-40, 0, 0)

    oneStep(world)

    expect(player.lastCrashAt).toBeLessThan(0)
  })

  it('с ×10000 касание планеты не даёт крушения', () => {
    const world = quiet()
    const player = world.player
    const planet = bodyOf(world, 'planet')
    player.state.scale = MIELOPHONE.GHOST_BODY_SCALE
    ram(world, planet, 40)

    oneStep(world)

    expect(player.lastCrashAt).toBeLessThan(0)
    expect(player.lastLostAt).toBeLessThan(0)
    // Не отскочили наружу (было бы vel.x > 0) — сквозь, как задумано.
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
