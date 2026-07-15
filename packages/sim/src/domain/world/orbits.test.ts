import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { updateCruise } from '../cruise/drive'
import { systemDefFor } from '../galaxy/jump'
import { createWorld, STARTER_SYSTEM } from './index'
import type { BodyEntity, World } from './entities'
import { stepOrbits } from './orbits'

/**
 * Спутники.
 *
 * Луна — не украшение: это тело с гравитацией и доступной поверхностью.
 * Поэтому её положение обязано быть таким же настоящим,
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

/** Промотать орбитное время на `orbitSeconds` (физические ω·t), затем пересчитать. */
function wait(world: World, orbitSeconds: number): void {
  world.calendarTime += orbitSeconds
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
    const planet = parentOf(world, moon)
    const before = moon.pos.clone().sub(planet.pos)

    // Четверть оборота: угол ровно π/2 — луна обязана уйти на радиус·√2 от планеты.
    wait(world, Math.PI / 2 / moon.orbit!.rate)
    const after = moon.pos.clone().sub(planet.pos)
    expect(before.distanceTo(after)).toBeCloseTo(moon.orbit!.radius * Math.SQRT2, -4)
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

  /**
   * Свита у гиганта, пара камней у скалы. Шесть — не «сколько не жалко», а край,
   * за которым имена кончаются: `moonName` даёт букву от `a`, и седьмая луна ещё
   * читается, а двадцать седьмая уедет за `z` в служебные символы.
   */
  it('у планеты не больше шести спутников, и все они названы буквами', () => {
    for (let index = 0; index < 60; index++) {
      const def = systemDefFor(index, GALAXY.SEED)
      for (const planet of def.planets) {
        expect(planet.moons.length).toBeLessThanOrEqual(6)
        for (const moon of planet.moons) expect(moon.name).toMatch(/ [a-z]$/)
      }
    }
  })

  /**
   * Размеры лун двугорбые: камни до 2000 км, миры от 2200. Провал между горбами
   * не косметика — на нём стоит порог рендера, который решает, рисовать луну
   * общим шариком или как планету, со складками и картой поверхности. Порог
   * посреди горба означал бы, что «крупность» решает третий знак радиуса.
   *
   * Тест живёт в домене, хотя бережёт рендер: провал — свойство ГЕНЕРАТОРА,
   * и заметить его исчезновение обязан тот, кто его создаёт.
   */
  it('размеры лун двугорбые: между камнем и миром есть провал', () => {
    let stones = 0
    let worlds = 0

    for (let index = 0; index < 200; index++) {
      for (const planet of systemDefFor(index, GALAXY.SEED).planets) {
        for (const moon of planet.moons) {
          // `SystemDef` уже в МЕТРАХ: камень ≤ 2000 км, мир ≥ 2200, между ними никого.
          const km = moon.radius / 1000
          expect(km > 2000 && km < 2200, `${moon.name} радиусом ${km} км попала в провал`).toBe(false)
          if (km >= 2200) worlds++
          else stones++
        }
      }
    }
    // Оба горба населены: без этого «провал» тривиально верен для пустого множества.
    expect(stones).toBeGreaterThan(0)
    expect(worlds).toBeGreaterThan(0)
  })

  /** Луна притягивает и принимает посадку, но крейсер сама не тормозит. */
  it('у поверхности луны крейсер продолжает разгон', () => {
    const world = quiet()
    const moon = moons(world)[0]!
    world.player.state.pos.copy(moon.pos).add(new Vector3(moon.radius + 100, 0, 0))
    for (let i = 0; i < 600; i++) updateCruise(world.player, world, true, 1 / 120)

    expect(world.player.cruise.factor).toBeGreaterThan(100)
    expect(world.player.cruise.block).toBeNull()
  })
})
