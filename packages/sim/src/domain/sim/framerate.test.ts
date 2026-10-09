import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { createWorld, type World } from '../world'
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
})
