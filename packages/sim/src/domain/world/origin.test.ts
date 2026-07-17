import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { createWorld } from './factory'
import { maybeShiftOrigin } from './origin'
import { stepOrbits } from './orbits'
import type { World } from './entities'

/**
 * ПЛАВАЮЩЕЕ НАЧАЛО КООРДИНАТ. Система задана в настоящих метрах (старт — в ста пятидесяти
 * миллионах километров от звезды), а матрицы у GPU float32: на 10¹¹ его шаг — километры.
 * Поэтому мир периодически сдвигают к нулю вслед за игроком.
 *
 * Инвариант ровно один и он жёсткий: сдвиг обязан двигать ВСЁ, у чего есть место в мире, —
 * иначе ВЗАИМНЫЕ расстояния поедут, и объект окажется не там, где ему положено.
 *
 * Список в `maybeShiftOrigin` — ручной, и это его слабость: новый список в `World` легко
 * завести и забыть строку. Так и вышло со статуями (уехали от причала за пол-а.е.), а аудит
 * по их следу вскрыл, что забыты были ещё болты, платформы, варпы, порталы и вспышки поля.
 * Эти тесты — страховка от следующего такого раза.
 */

/** Мир, отлетевший за порог: следующий `maybeShiftOrigin` обязан сработать. */
function farFromOrigin(): World {
  const world = createWorld()
  world.player.state.pos.set(PHYSICS.FLOATING_ORIGIN_RADIUS * 2, 0, 0)
  return world
}

describe('плавающее начало координат', () => {
  it('сдвиг случается только за порогом, а не на каждом кадре', () => {
    const world = createWorld()
    world.player.state.pos.set(1, 2, 3)
    maybeShiftOrigin(world)
    // Близко к нулю — мир не трогаем: иначе он дёргался бы постоянно.
    expect(world.player.state.pos.toArray()).toEqual([1, 2, 3])
  })

  it('игрок уезжает в ноль, а мир — вслед за ним', () => {
    const world = farFromOrigin()
    maybeShiftOrigin(world)
    expect(world.player.state.pos.length()).toBeCloseTo(0, 6)
  })

  /**
   * ГЛАВНОЕ. Проверяем не координаты, а ВЗАИМНЫЕ расстояния: сдвиг — это смена системы отсчёта,
   * и относительно игрока не должно измениться ровно ничего. Забытый список провалит именно это.
   */
  it('взаимные расстояния до всего сущего не меняются', () => {
    const world = farFromOrigin()
    const from = world.player.state.pos.clone()

    // Всё, у чего есть место в мире. `shockwaves` и `muzzleFlashes` сюда не входят намеренно:
    // у первых места нет вовсе, вторые держатся за id стрелка и едут с ним сами.
    const probes: { what: string; pos: Vector3 }[] = [
      ...world.bodies.map((b) => ({ what: `тело ${b.name}`, pos: b.pos })),
      ...world.ships.map((s) => ({ what: `борт ${s.name}`, pos: s.state.pos })),
      ...world.asteroids.map((a) => ({ what: 'астероид', pos: a.pos })),
      ...world.monoliths.map((m) => ({ what: 'статуя', pos: m.pos })),
      ...world.titans.map((t) => ({ what: 'кит', pos: t.pos })),
      ...world.platforms.map((p) => ({ what: 'платформа', pos: p.pos })),
      ...world.pods.map((p) => ({ what: 'контейнер', pos: p.pos })),
      ...world.bolts.map((b) => ({ what: 'болт', pos: b.pos })),
      ...world.missiles.map((m) => ({ what: 'ракета', pos: m.pos })),
    ]
    expect(probes.length).toBeGreaterThan(0)
    const before = probes.map((p) => ({ what: p.what, d: p.pos.distanceTo(from) }))

    maybeShiftOrigin(world)

    probes.forEach((p, i) => {
      // Метры на десятках миллиардов: сравниваем с допуском, а не побитово.
      const d = p.pos.distanceTo(world.player.state.pos)
      const was = before[i]!
      expect(Math.abs(d - was.d), `${was.what} уехал при сдвиге`).toBeLessThan(1)
    })
  })

  /** Статуя держится СВОЕГО причала: это и был симптом — 500 световых секунд до неё. */
  it('статуи не отрываются от причала', () => {
    const world = farFromOrigin()
    const station = world.bodies.find((b) => b.kind === 'station')!
    const before = world.monoliths.map((m) => m.pos.distanceTo(station.pos))
    expect(before.length).toBeGreaterThan(0)

    maybeShiftOrigin(world)

    world.monoliths.forEach((m, i) => {
      expect(m.pos.distanceTo(station.pos)).toBeCloseTo(before[i]!, 3)
    })
  })
})

/**
 * ОРБИТА ПРИЧАЛА — вторая, отдельная система отсчёта, и вторая такая же ловушка.
 *
 * Станция обращается вместе со своей планетой вокруг звезды, а вся окрестность, рождённая у
 * причала, живёт в его ПОСТУПАТЕЛЬНОЙ системе отсчёта: `stepOrbits` сдвигает её вслед за ним.
 * Список там тоже ручной. Статуй в нём не было — и они, поставленные в двадцати километрах от
 * причала, отставали на АСТРОНОМИЧЕСКУЮ ЕДИНИЦУ (время в игре сжато): те самые 500 световых
 * секунд. Мало было починить `maybeShiftOrigin` — сдвигов ДВА, и оба ручные.
 */
describe('окрестность едет вместе с причалом по его орбите', () => {
  it('статуя держится причала, когда тот уходит по орбите', () => {
    const world = createWorld()
    const station = world.bodies.find((b) => b.kind === 'station')!
    const before = world.monoliths.map((m) => m.pos.distanceTo(station.pos))
    expect(before.length).toBeGreaterThan(0)

    // Проматываем орбиты далеко вперёд: причал уедет вместе с планетой.
    const moved = station.pos.clone()
    stepOrbits(world, 1e6)
    expect(station.pos.distanceTo(moved)).toBeGreaterThan(1000) // причал и правда уехал

    world.monoliths.forEach((m, i) => {
      expect(m.pos.distanceTo(station.pos), 'статуя отстала от причала').toBeCloseTo(before[i]!, 3)
    })
  })
})
