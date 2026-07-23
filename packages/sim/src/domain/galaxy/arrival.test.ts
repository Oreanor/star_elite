import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ARRIVAL } from '../../config/galaxy'
import { STARTER_SYSTEM } from '../world/system'
import { arrivalBounds, arrivalPoint, stationSeat } from './arrival'

/**
 * Точка выхода из прыжка.
 *
 * Прыжок обязан оставлять дорогу: выйти вплотную к причалу — значит превратить
 * перелёт в телепорт. И обязан оставлять её КОНЕЧНОЙ: пустое место выбирается
 * внутри пояса обитаемых орбит, а не в короне и не за краем системы.
 */

const at = (p: readonly [number, number, number]) => new Vector3(...p)
const STAR = at(STARTER_SYSTEM.star.pos)

/** Расстояние от звезды: именно оно зажимается поясом, а не расстояние от нуля. */
const orbitOf = (p: readonly [number, number, number]) => at(p).distanceTo(STAR)

describe('точка выхода из прыжка', () => {
  it('без выбора выходим туда же, куда и всегда', () => {
    expect(arrivalPoint(STARTER_SYSTEM, null)).toBe(STARTER_SYSTEM.playerStart)
  })

  it('пояс выхода — от внутренней орбиты до внешней', () => {
    const bounds = arrivalBounds(STARTER_SYSTEM)
    expect(bounds).not.toBeNull()
    if (!bounds) return

    const orbits = STARTER_SYSTEM.planets.map((p) => orbitOf(p.pos))
    expect(bounds.min).toBeCloseTo(Math.min(...orbits), 0)
    expect(bounds.max).toBeCloseTo(Math.max(...orbits), 0)
  })

  it('система без планет не даёт пояса: выбирать не из чего', () => {
    expect(arrivalBounds({ ...STARTER_SYSTEM, planets: [] })).toBeNull()
  })

  /**
   * Ближе внутренней планеты выходить некуда — там корона; дальше внешней незачем —
   * там пусто, а обратно лететь четверть часа. Зажимает домен, а не карта: правило
   * одно и то же и для крестика, и для сервера.
   */
  it('пустое место зажато поясом с обеих сторон', () => {
    const bounds = arrivalBounds(STARTER_SYSTEM)!

    const tooClose = arrivalPoint(STARTER_SYSTEM, { kind: 'point', orbit: 1, angle: 0.3 })
    const tooFar = arrivalPoint(STARTER_SYSTEM, { kind: 'point', orbit: 1e14, angle: 0.3 })

    expect(orbitOf(tooClose)).toBeCloseTo(bounds.min, 0)
    expect(orbitOf(tooFar)).toBeCloseTo(bounds.max, 0)
  })

  it('пустое место внутри пояса берётся как есть', () => {
    const bounds = arrivalBounds(STARTER_SYSTEM)!
    const orbit = (bounds.min + bounds.max) / 2

    const point = arrivalPoint(STARTER_SYSTEM, { kind: 'point', orbit, angle: 1.1 })
    expect(orbitOf(point)).toBeCloseTo(orbit, 0)
  })

  /**
   * У планеты со станцией дорога считается ДО ПРИЧАЛА: лететь пилот будет к нему, и
   * минута пути должна остаться до причала, а не до планеты, вокруг которой он висит.
   */
  it('к обитаемому миру выходим на дороге до ПРИЧАЛА, а не до планеты', () => {
    const seat = stationSeat(STARTER_SYSTEM)
    expect(seat).toBeGreaterThanOrEqual(0)

    const station = STARTER_SYSTEM.station!
    const point = arrivalPoint(STARTER_SYSTEM, { kind: 'body', planet: seat })
    const range = at(point).distanceTo(at(station.pos)) - station.radius

    expect(range).toBeCloseTo(ARRIVAL.STANDOFF, 0)
  })

  /**
   * РЕГРЕССИЯ: отход отсчитывался ОТ СТАНЦИИ и вёл «наружу от звезды». Станция же висит
   * в двух-девяти сотнях километров над поверхностью, и эта тысяча километров приводила
   * НА ТУ ЖЕ ОРБИТУ: замер (`scratch/arrival-drift.ts`) показал выход в 267-347 км над
   * поверхностью — планетой в полнеба, и корабль цеплял её первым же манёвром.
   *
   * Инвариант: точка выхода лежит ВНЕ сферы, где живут и планета, и её причал.
   */
  it('к обитаемому миру не выходим на орбите причала — только за ней', () => {
    const seat = stationSeat(STARTER_SYSTEM)
    const planet = STARTER_SYSTEM.planets[seat]!
    const station = STARTER_SYSTEM.station!
    const point = arrivalPoint(STARTER_SYSTEM, { kind: 'body', planet: seat })

    const fromCentre = at(point).distanceTo(at(planet.pos))
    const orbit = at(station.pos).distanceTo(at(planet.pos))
    expect(fromCentre - planet.radius).toBeGreaterThanOrEqual(ARRIVAL.STANDOFF)
    expect(fromCentre).toBeGreaterThan(orbit)
  })

  /** Выход не внутри тела и не между ним и звездой: планета не должна закрыть кадр. */
  it('выходим снаружи тела, со стороны от звезды', () => {
    const planet = STARTER_SYSTEM.planets[1]! // газовый гигант, причала на нём нет
    const point = arrivalPoint(STARTER_SYSTEM, { kind: 'body', planet: 1 })

    const surface = at(point).distanceTo(at(planet.pos)) - planet.radius
    expect(surface).toBeCloseTo(ARRIVAL.STANDOFF, 0)
    // Дальше от звезды, чем сама планета: значит с внешней стороны, а не с теневой.
    expect(orbitOf(point)).toBeGreaterThan(orbitOf(planet.pos))
  })

  it('несуществующая планета не роняет прыжок', () => {
    expect(arrivalPoint(STARTER_SYSTEM, { kind: 'body', planet: 99 })).toBe(STARTER_SYSTEM.playerStart)
  })
})
