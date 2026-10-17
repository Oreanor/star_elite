import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { CORE_INDEX, GALAXY } from '../../config/galaxy'
import { QUASAR } from '../../config/beams'
import { generateSystem } from '../galaxy/generate'
import { quasarOf } from '../galaxy/quasar'
import { jump, systemDefFor } from '../galaxy/jump'
import { createWorld } from './factory'
import { beamDirection, beamExposure } from './beams'
import type { World } from './entities'

/**
 * Квазары и пульсары — свойства из зерна, а лучи — одна механика для обоих. Проверяем
 * инварианты: детерминизм, доля, безопасное прибытие, жжёт ровно там, где луч, и маяк
 * действительно метёт.
 */

/** Зерно галактики с квазаром (и без), найденное перебором: какое — неважно, важно, что есть. */
function seedWhere(quasar: boolean): number {
  for (let s = 1; s < 10_000; s++) if ((quasarOf(s) !== null) === quasar) return s
  throw new Error('не нашлось зерна')
}

/**
 * Мир у Ядра галактики. Строится секунды (новая галактика), поэтому прибытие кэшируем по
 * зерну; тесты, что двигают корабль или время, берут свежую копию позы сами.
 */
const coreCache = new Map<number, World>()
function worldAtCore(galaxySeed: number): World {
  const hit = coreCache.get(galaxySeed)
  if (hit) return hit
  const world = createWorld()
  world.galaxySeed = galaxySeed
  world.player.spec.jumpRange = 1e6
  world.player.jumpCharge = 1e6
  jump(world, CORE_INDEX)
  coreCache.set(galaxySeed, world)
  return world
}

describe('квазары', () => {
  it('одно зерно — один ответ; доля близка к заданной', () => {
    expect(quasarOf(12345)).toEqual(quasarOf(12345))
    let n = 0
    const N = 4000
    for (let s = 0; s < N; s++) if (quasarOf(s)) n++
    expect(n / N).toBeGreaterThan(QUASAR.SHARE * 0.7)
    expect(n / N).toBeLessThan(QUASAR.SHARE * 1.3)
  })

  it('ось джетов почти вертикальна — не круче заданного наклона', () => {
    for (let s = 0; s < 2000; s++) {
      const axis = quasarOf(s)
      if (axis) expect(Math.acos(axis[1])).toBeLessThanOrEqual(QUASAR.MAX_TILT + 1e-9)
    }
  })

  it('у квазара в Ядре есть джеты, у спокойного ядра — нет', () => {
    const hot = worldAtCore(seedWhere(true)).bodies.find((b) => b.kind === 'blackhole')!
    const calm = worldAtCore(seedWhere(false)).bodies.find((b) => b.kind === 'blackhole')!
    expect(hot.beams).toBeDefined()
    expect(calm.beams).toBeUndefined()
  })

  /** Прибытие в Ядро лежит в плоскости, а джет почти вертикален: выходишь не в столб. */
  it('прыжок в квазарное Ядро выводит вне джетов', () => {
    for (let k = 0, s = 1; k < 3 && s < 50_000; s++) {
      if (!quasarOf(s)) continue
      k++
      const world = worldAtCore(s)
      expect(beamExposure(world.player, world)).toBe(0)
    }
  })

  it('на оси джета — полная облучённость, в стороне — ноль', () => {
    const world = worldAtCore(seedWhere(true))
    const hole = world.bodies.find((b) => b.kind === 'blackhole')!
    const dir = beamDirection(hole, world.time, new Vector3())
    world.player.state.pos.copy(hole.pos).addScaledVector(dir, hole.beams!.length * 0.3)
    expect(beamExposure(world.player, world)).toBeCloseTo(1, 5)
    // Встречный джет жжёт так же.
    world.player.state.pos.copy(hole.pos).addScaledVector(dir, -hole.beams!.length * 0.3)
    expect(beamExposure(world.player, world)).toBeCloseTo(1, 5)
  })
})

describe('пульсары', () => {
  function pulsarWorld(): World | null {
    for (let i = 1; i < GALAXY.COUNT; i++) {
      if (generateSystem(i, GALAXY.SEED).star.class !== 'N') continue
      const world = createWorld()
      world.player.spec.jumpRange = 1e6
      world.player.jumpCharge = 1e6
      jump(world, i)
      return world
    }
    return null
  }

  it('у пульсара есть вращающиеся лучи; у обычной звезды — нет', () => {
    const world = pulsarWorld()
    expect(world).not.toBeNull()
    const star = world!.bodies.find((b) => b.kind === 'star')!
    expect(star.beams).toBeDefined()
    expect(star.spin).not.toBe(0)
    const plain = createWorld().bodies.find((b) => b.kind === 'star')!
    expect(plain.beams).toBeUndefined()
  })

  /** Маяк метёт: точка, где луч сейчас, через пол-оборота уже не в луче. */
  it('луч маяка уходит за пол-оборота', () => {
    const world = pulsarWorld()!
    const star = world.bodies.find((b) => b.kind === 'star')!
    const dir = beamDirection(star, world.time, new Vector3())
    world.player.state.pos.copy(star.pos).addScaledVector(dir, star.beams!.length * 0.5)
    expect(beamExposure(world.player, world)).toBeGreaterThan(0.9)
    world.time += Math.PI / star.spin // половина периода
    expect(beamExposure(world.player, world)).toBeLessThan(0.5)
  })

  it('луч пульсара не дотягивается до ближайшей орбиты планет', () => {
    const world = pulsarWorld()!
    const star = world.bodies.find((b) => b.kind === 'star')!
    const nearest = Math.min(...world.bodies.filter((b) => b.kind === 'planet').map((p) => p.pos.distanceTo(star.pos) - p.radius))
    if (Number.isFinite(nearest)) expect(star.beams!.length).toBeLessThan(nearest)
  })

  it('описание системы детерминировано: тот же пульсар у всех', () => {
    const i = (() => {
      for (let k = 1; k < GALAXY.COUNT; k++) if (generateSystem(k, GALAXY.SEED).star.class === 'N') return k
      return -1
    })()
    expect(systemDefFor(i, GALAXY.SEED).star.pulsar).toEqual(systemDefFor(i, GALAXY.SEED).star.pulsar)
  })
})
