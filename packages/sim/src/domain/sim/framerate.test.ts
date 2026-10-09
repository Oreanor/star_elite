import { Quaternion, Vector3 } from 'three'
import { pirateLoadout } from '../../config/loadouts'
import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { createWorld, type World } from '../world'
import { makeShip, startAtStation } from '../world'
import { NULL_CONTROLLER, type Controller } from './controller'
import { renderPos } from '../world/poseTrail'
import { STARTER_SYSTEM } from '../world/system'
import { quietWorld } from '../../testkit'
import { stepWorld } from './step'

/** Прокрутить мир кадрами по `frameDt`, пока его часы не дойдут до `until`. */
function runUntil(world: World, frameDt: number, until: number): void {
  while (world.time < until - 1e-9) stepWorld(world, frameDt, new Map())
}

/** Отпечаток мира: кто есть, где стоит и куда дошёл поток случайности. */
function fingerprint(world: World): string {
  const ships = world.ships.map((s) => `${s.id}:${s.state.pos.toArray().map((v) => v.toFixed(3)).join(',')}`)
  return [world.time.toFixed(6), world.rng(), world.asteroids.length, world.bolts.length, ...ships].join('|')
}

describe('частота кадров', () => {
  /**
   * Регрессия: трафик, киты, турели и уборка шли раз в КАДР, а последний такт кадра был
   * укороченным — досчитывал остаток. И число бросков `world.rng`, и сами шаги физики
   * зависели от монитора: одно зерно давало разный мир на 60 и на 144 Гц. Теперь такт всегда
   * ровно FIXED_DT, остаток ждёт следующего кадра — те же такты дают тот же мир.
   */
  it('одно зерно — один мир на 60, 120 и 144 кадрах', () => {
    const worlds = [1 / 60, 1 / 120, 1 / 144].map((frameDt) => {
      const world = createWorld(STARTER_SYSTEM)
      runUntil(world, frameDt, 90)
      return world
    })
    expect(worlds[0]!.ships.length).toBeGreaterThan(0)
    const [a, b, c] = worlds.map(fingerprint)
    expect(b).toBe(a)
    expect(c).toBe(a)
  })

  /** Такт не бывает дробным: часы мира идут только целыми FIXED_DT. */
  it('часы мира идут целыми тактами, остаток ждёт следующего кадра', () => {
    const world = quietWorld()
    stepWorld(world, 1 / 144, new Map())
    expect(world.time).toBe(0)
    expect(world.renderAlpha).toBeCloseTo((1 / 144) / PHYSICS.FIXED_DT, 6)
    stepWorld(world, 1 / 144, new Map())
    expect(world.time).toBeCloseTo(PHYSICS.FIXED_DT, 9)
  })
})

describe('показ между тактами', () => {
  /** Рендер показывает тело МЕЖДУ позой до такта и после — иначе на 144 Гц оно дёргается. */
  it('поза для показа лежит между тактами, на долю остатка', () => {
    const world = quietWorld()
    const p = world.player.state
    p.vel.set(100, 0, 0)
    stepWorld(world, PHYSICS.FIXED_DT, new Map())
    const before = p.pos.x
    stepWorld(world, PHYSICS.FIXED_DT * 1.5, new Map())
    const after = p.pos.x
    const shown = renderPos(world, p, new Vector3()).x
    expect(after).toBeGreaterThan(before)
    expect(shown).toBeGreaterThan(before)
    expect(shown).toBeLessThan(after)
  })

  /**
   * Телепорт снаружи такта (прыжок, отчаливание) показывается сразу на новом месте: тянуть
   * тело от старого места через пол-системы — артефакт, а помнить о сбросе следа ни одно
   * место, переставляющее тело, не обязано.
   */
  it('переставленное снаружи тело не тянется от старого места', () => {
    const world = quietWorld()
    const p = world.player.state
    p.vel.set(100, 0, 0)
    stepWorld(world, PHYSICS.FIXED_DT * 1.5, new Map())
    p.pos.set(1000, 2000, 3000)
    expect(renderPos(world, p, new Vector3()).toArray()).toEqual([1000, 2000, 3000])
    // И следующий кадр без единого такта — тоже на новом месте.
    p.vel.set(0, 0, 0)
    stepWorld(world, PHYSICS.FIXED_DT * 0.25, new Map())
    expect(renderPos(world, p, new Vector3()).toArray()).toEqual([1000, 2000, 3000])
  })

  /** Сдвиг плавающего начала везёт и следы: в кадр сдвига тело не протягивается через мир. */
  it('сдвиг начала координат не даёт протяжки', () => {
    const world = quietWorld()
    const p = world.player.state
    p.pos.set(PHYSICS.FLOATING_ORIGIN_RADIUS - 1, 0, 0)
    p.vel.set(500, 0, 0)
    stepWorld(world, PHYSICS.FIXED_DT * 1.5, new Map())
    expect(world.originShift.lengthSq()).toBeGreaterThan(0)
    // Показанная поза — в пределах одного такта хода от настоящей, а не в километрах.
    expect(renderPos(world, p, new Vector3()).distanceTo(p.pos)).toBeLessThan(500 * PHYSICS.FIXED_DT * 1.01)
  })

  /**
   * Регрессия: у станции игрока несёт её орбита — десятки км/с, сотни метров за такт. Камера
   * получает этот перенос сразу (`originShift`), а показ отставал на долю такта: корабль
   * дёргался вбок на корпус. Перенос опорой — смена системы отсчёта, следы едут вместе с ним:
   * стоящий у станции корабль показывается там, где он есть, без отставания на орбиту.
   */
  it('перенос орбитой станции не даёт отставания показа', () => {
    const world = quietWorld()
    startAtStation(world, 2_500)
    const station = world.bodies.find((b) => b.kind === 'station')!
    const p = world.player.state
    p.vel.set(0, 0, 0)
    let carried = 0
    for (let i = 0; i < 40; i++) {
      // Календарь двигает клиент раз в кадр (реальное время) — орбиты едут от него.
      world.calendarTime += PHYSICS.FIXED_DT * 1.37
      stepWorld(world, PHYSICS.FIXED_DT * 1.37, new Map())
      carried = Math.max(carried, world.originShift.length())
      const shownPlayer = renderPos(world, p, new Vector3())
      const shownStation = renderPos(world, station, new Vector3())
      // Камера сдвинута на перенос СРАЗУ — значит и стоящий корабль показан там, где он есть,
      // а не на долю такта позади по орбите.
      expect(shownPlayer.distanceTo(p.pos)).toBeLessThan(1)
      // И относительно станции показ совпадает с симуляцией.
      const rel = shownPlayer.clone().sub(shownStation)
      const simRel = p.pos.clone().sub(station.pos)
      expect(rel.distanceTo(simRel)).toBeLessThan(1)
    }
    // Перенос действительно был — иначе тест ничего не проверял.
    expect(carried).toBeGreaterThan(1)
  })

  /**
   * Регрессия: календарь (а от него — орбиты) клиент ставил раз в кадр по реальным часам —
   * вторые часы в симуляции, орбиты сдвигались рывком раз в кадр, мимо такта. Теперь
   * календарь идёт тактами и лишь держится у общих часов; после паузы — догоняет сразу.
   */
  it('календарь идёт тактами и держится у общих часов', () => {
    const world = quietWorld()
    world.calendarClock = 1000
    stepWorld(world, PHYSICS.FIXED_DT, new Map())
    // Первое показание — прыжок сразу: расхождение огромное.
    expect(world.calendarTime).toBeCloseTo(1000, 6)

    const frame = 1 / 144
    for (let i = 0; i < 1440; i++) {
      world.calendarClock += frame
      const before = world.calendarTime
      stepWorld(world, frame, new Map())
      // В кадре без такта календарь стоит: он идёт тактами, а не кадрами.
      if (world.time === 0) continue
      expect(world.calendarTime).toBeGreaterThanOrEqual(before)
    }
    expect(Math.abs(world.calendarClock - world.calendarTime)).toBeLessThan(0.05)

    // Пауза: общие часы ушли на минуту — календарь догоняет сразу, а не ползёт.
    world.calendarClock += 60
    stepWorld(world, PHYSICS.FIXED_DT, new Map())
    expect(Math.abs(world.calendarClock - world.calendarTime)).toBeLessThan(0.05)
  })

  /**
   * Регрессия: борт, рождённый трафиком посреди кадра, до следующего кадра не значился в
   * карте пилотов и несколько тактов летел без управления. Пилот по умолчанию (`unassigned`)
   * берёт его с первого же такта.
   */
  it('борт без назначения ведёт пилот по умолчанию с первого такта', () => {
    const world = quietWorld()
    const stray = makeShip(world.ids, 'neutral', 'Без пилота', pirateLoadout(), new Vector3(500, 0, 0), new Quaternion())
    world.ships.push(stray)
    const piloted: number[] = []
    const fallback: Controller = { ...NULL_CONTROLLER, update: (ship) => void piloted.push(ship.id) }
    stepWorld(world, PHYSICS.FIXED_DT, new Map(), { unassigned: fallback })
    expect(piloted).toContain(stray.id)
  })
})
