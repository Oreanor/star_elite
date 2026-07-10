import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { systemDefFor } from '../galaxy/jump'
import { createWorld, STARTER_SYSTEM } from './index'
import type { BodyEntity, World } from './entities'
import { stepOrbits } from './orbits'

/**
 * Спутники.
 *
 * Луна — не украшение: это тело с корой, о которую разбиваются, и с зоной
 * торможения крейсера. Поэтому её положение обязано быть таким же настоящим,
 * как у планеты, и таким же воспроизводимым — иначе сервер и клиент разойдутся
 * в том, где она висит.
 */

const quiet = (): World => createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })

const moons = (world: World): BodyEntity[] => world.bodies.filter((b) => b.kind === 'moon')

function parentOf(world: World, moon: BodyEntity): BodyEntity {
  const parent = world.bodies.find((b) => b.id === moon.orbit?.parentId)
  if (!parent) throw new Error('у спутника нет планеты')
  return parent
}

/** Сколько секунд «промотать», не двигая ничего, кроме времени. */
function wait(world: World, seconds: number): void {
  world.time += seconds
  stepOrbits(world)
}

describe('спутники', () => {
  it('рождаются на орбите, а не в центре планеты', () => {
    const world = quiet()
    expect(moons(world).length).toBeGreaterThan(0)

    for (const moon of moons(world)) {
      const range = moon.pos.distanceTo(parentOf(world, moon).pos)
      expect(range).toBeCloseTo(moon.orbit!.radius, 0)
    }
  })

  /** Орбита круговая: расстояние до планеты — инвариант, что бы ни было со временем. */
  it('держат постоянное расстояние до своей планеты', () => {
    const world = quiet()
    const moon = moons(world)[0]!
    const planet = parentOf(world, moon)

    for (const seconds of [1, 1000, 1e5, 1e7]) {
      wait(world, seconds)
      expect(moon.pos.distanceTo(planet.pos)).toBeCloseTo(moon.orbit!.radius, 0)
    }
  })

  it('обращаются: за четверть периода уходят с прежнего места', () => {
    const world = quiet()
    const moon = moons(world)[0]!
    const before = moon.pos.clone()

    // Четверть оборота: угол ровно π/2 — луна обязана уйти на радиус·√2.
    wait(world, Math.PI / 2 / moon.orbit!.rate)
    expect(moon.pos.distanceTo(before)).toBeCloseTo(moon.orbit!.radius * Math.SQRT2, -4)
  })

  /**
   * Период выводится из массы планеты (ω = √(GM/r³)), а не назначается. Луна
   * Оссиании стоит там же, где настоящая, и обязана обходить её примерно за месяц.
   * Назначенный период дал бы луне сотни километров в секунду — она сшибала бы
   * корабль на ровном месте.
   */
  it('период настоящий: у луны Оссиании выходит месяц, а не десять минут', () => {
    const world = quiet()
    const moon = moons(world).find((m) => m.name === 'Оссиания a')!
    const days = (2 * Math.PI) / moon.orbit!.rate / 86_400

    expect(days).toBeGreaterThan(20)
    expect(days).toBeLessThan(45)
  })

  /** Положение следует ИЗ ВРЕМЕНИ, а не копится по шагам: два мира сойдутся. */
  it('положение спутника воспроизводимо', () => {
    const a = quiet()
    const b = quiet()

    wait(a, 12_345)
    // Тот же час, но набранный тысячей мелких шагов.
    for (let i = 0; i < 1000; i++) wait(b, 12.345)

    const first = moons(a)[0]!
    const second = moons(b)[0]!
    expect(first.pos.distanceTo(second.pos)).toBeLessThan(1)
  })

  it('у планеты не больше двух спутников', () => {
    // Каждая луна — своя зона торможения крейсера. Полсотни лун — патока.
    for (let index = 0; index < 60; index++) {
      const def = systemDefFor(index, GALAXY.SEED)
      for (const planet of def.planets) expect(planet.moons.length).toBeLessThanOrEqual(2)
    }
  })
})
