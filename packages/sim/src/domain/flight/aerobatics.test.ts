import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { MANOEUVRE } from '../../config/manoeuvre'
import { PHYSICS } from '../../config/physics'
import { stepWorld, type Controller } from '../sim'
import { createWorld, STARTER_SYSTEM, type ShipEntity, type World } from '../world'
import { beginManoeuvre, createManoeuvre, stepManoeuvre, type Manoeuvre, type ManoeuvreKind } from './aerobatics'
import { forward } from './axes'

/**
 * Фигуры пилотажа проверяются ФИЗИКОЙ, а не намерением: контроллер только держит
 * ручку, а куда от этого повернётся корабль, решает интегратор. Поэтому тест
 * гоняет настоящий `stepWorld` и смотрит на курс, а не на счётчик углов.
 *
 * Регрессия, ради которой тест и написан: тяга петли выводится из угловой
 * скорости (v = ω·R), а та в первый миг равна нулю. Формула просила нулевую тягу,
 * лётный компьютер честно гасил ход, и петля вырождалась в кувыркание на месте —
 * корабль не улетал вперёд, но и петли не выходило.
 */

/** Далеко от всего: у станции и планеты корабль сталкивается, а не крутит петли. */
const DEEP_SPACE = new Vector3(2e9, 0, 0)

interface Flight {
  world: World
  m: Manoeuvre
  /** Курс до фигуры и после, единичные векторы. */
  before: Vector3
  after: Vector3
  /** Сколько корабль ушёл ВПЕРЁД по прежнему курсу, м. */
  advance: number
  /** Сколько он отклонился вбок и вверх от прежней линии, м. */
  offset: number
  seconds: number
}

function fly(kind: ManoeuvreKind, dir: -1 | 1 = 1, speed = 180): Flight {
  const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
  const ship = world.player
  ship.state.pos.copy(DEEP_SPACE)
  ship.state.quat.identity() // нос в −Z
  ship.state.vel.set(0, 0, -speed)
  ship.state.angVel.set(0, 0, 0)
  ship.controls.throttle = speed / ship.spec.tuning.MAX_SPEED

  const m = createManoeuvre()
  beginManoeuvre(m, kind, dir)

  // Истинные координаты: плавающее начало отсчёта сдвинет мир прямо посреди фигуры.
  const start = ship.state.pos.clone().add(world.originOffset)
  const before = forward(ship.state.quat, new Vector3())

  const pilot: Controller = {
    update(s: ShipEntity, _w: World, dt: number) {
      s.controls.flightAssist = true
      s.controls.boost = 1
      s.controls.retro = 0
      s.controls.yaw = 0
      if (!stepManoeuvre(s, m, dt)) {
        s.controls.pitch = 0
        s.controls.roll = 0
      }
    },
    wantsFire: () => false,
  }

  const controllers = new Map<number, Controller>([[ship.id, pilot]])
  const dt = PHYSICS.FIXED_DT
  let seconds = 0
  while (m.kind !== null && seconds < MANOEUVRE.MAX_DURATION + 1) {
    stepWorld(world, dt, controllers)
    seconds += dt
  }

  const travel = ship.state.pos.clone().add(world.originOffset).sub(start)
  const advance = travel.dot(before)
  const offset = travel.clone().addScaledVector(before, -advance).length()

  return { world, m, before, after: forward(ship.state.quat, new Vector3()), advance, offset, seconds }
}

describe('фигуры пилотажа', () => {
  it('петля возвращает корабль на прежний курс', () => {
    const { before, after, seconds } = fly('loop')

    expect(seconds).toBeLessThan(MANOEUVRE.MAX_DURATION)
    // Курс тот же с точностью до нескольких градусов: угол меряется по фактической
    // угловой скорости, и последний шаг всегда чуть перелетает.
    expect(before.dot(after)).toBeGreaterThan(0.99)
  })

  /**
   * И продолжает лететь вперёд. Петля — это круг в вертикальной плоскости, а не
   * остановка: корабль обязан пройти вдоль прежнего курса заметное расстояние.
   */
  it('петля не гасит ход: корабль продолжает движение вперёд', () => {
    const { advance } = fly('loop')
    expect(advance).toBeGreaterThan(MANOEUVRE.LOOP_RADIUS)
  })

  /**
   * Но и не улетает: круг задан радиусом, а не рукоятью газа. Раньше `throttle`
   * в момент двойного нажатия W стоял на единице, круг распухал до полукилометра,
   * и корабль уносился вперёд вместо того, чтобы пропустить преследователя.
   */
  it('петля укладывается в свой радиус', () => {
    const { advance, offset } = fly('loop')
    expect(advance).toBeLessThan(MANOEUVRE.LOOP_RADIUS * 8)
    // Круг замкнулся: в конце корабль снова на прежней линии, а не сбоку от неё.
    expect(offset).toBeLessThan(MANOEUVRE.LOOP_RADIUS * 2)
  })

  it('петля через низ — та же петля, только вниз', () => {
    const up = fly('loop', 1)
    const down = fly('loop', -1)
    expect(down.before.dot(down.after)).toBeGreaterThan(0.99)
    // Обе возвращают на курс, но уводят в разные стороны по вертикали.
    expect(up.seconds).toBeCloseTo(down.seconds, 1)
  })

  it('разворот ставит корабль носом назад', () => {
    const { before, after, seconds } = fly('reversal')

    expect(seconds).toBeLessThan(MANOEUVRE.MAX_DURATION)
    // Не строгие 180°: полупетля меряется по фактической угловой скорости и
    // на последнем шаге всегда чуть перелетает. Важно, что нос смотрит назад.
    expect(before.dot(after)).toBeLessThan(-0.95)
  })

  /**
   * Разворот не должен уносить вперёд: его затем и крутят, что преследователь
   * сидит на хвосте. Полупетля идёт тем же радиусом, что и петля.
   */
  it('разворот не уносит корабль далеко вперёд', () => {
    const { advance } = fly('reversal')
    expect(advance).toBeLessThan(MANOEUVRE.LOOP_RADIUS * 6)
  })

  it('бочка сохраняет и курс, и линию полёта', () => {
    const { before, after, offset } = fly('barrel')

    expect(before.dot(after)).toBeGreaterThan(0.99)
    // Тяга маневровых удерживается в неподвижном направлении, поэтому корабль
    // СХОДИТ с прежней линии — в этом вся суть уклонения.
    expect(offset).toBeGreaterThan(10)
  })

  it('фигура остывает: вторую подряд не начать', () => {
    const { m } = fly('loop')
    expect(m.cooldown).toBeGreaterThan(0)
    expect(beginManoeuvre(m, 'loop', 1)).toBe(false)
  })
})
