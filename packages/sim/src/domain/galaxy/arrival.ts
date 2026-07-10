import { ARRIVAL } from '../../config/galaxy'
import type { SystemDef } from '../world/system'

/**
 * Куда выходит корабль из гиперпрыжка.
 *
 * Правило живёт в домене, а не в карте: карта лишь показывает то, что посчитано
 * здесь, и однажды то же самое посчитает сервер. Крестик на схеме — это ввод,
 * а не решение.
 *
 * Прыгать можно в ПУСТОЕ МЕСТО системы или к конкретной планете. Пустое место
 * зажато поясом обитаемых орбит: ближе внутренней планеты выходить некуда (там
 * корона), дальше внешней — незачем (там нет ничего, а лететь обратно четверть
 * часа). К планете выходят с удаления, с которого до неё минута-две крейсерского
 * хода: прыжок обязан оставлять дорогу, иначе перелёт превращается в телепорт.
 */

/** Точка выхода. Либо тело, либо место — третьего в системе нет. */
export type Arrival =
  | { readonly kind: 'body'; readonly planet: number }
  | { readonly kind: 'point'; readonly orbit: number; readonly angle: number }

export type Point3 = readonly [number, number, number]

const distance = (a: Point3, b: Point3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Радиус орбиты планеты — расстояние до звезды, а не до нуля координат. */
function orbitOf(def: SystemDef, planet: SystemDef['planets'][number]): number {
  return distance(planet.pos, def.star.pos)
}

/**
 * Пояс, в который разрешено выходить: от внутренней орбиты до внешней.
 * `null` — планет нет, и выбирать не из чего: некуда ставить ни ближнюю границу,
 * ни дальнюю.
 */
export function arrivalBounds(def: SystemDef): { min: number; max: number } | null {
  if (def.planets.length === 0) return null
  const orbits = def.planets.map((p) => orbitOf(def, p))
  return { min: Math.min(...orbits), max: Math.max(...orbits) }
}

/** Чья это станция. `-1` — станции нет или она ничья. */
export function stationSeat(def: SystemDef): number {
  if (!def.station) return -1
  let seat = -1
  let best = Infinity
  def.planets.forEach((planet, i) => {
    const d = distance(planet.pos, def.station!.pos)
    if (d < best) {
      best = d
      seat = i
    }
  })
  return seat
}

/**
 * Отойти от тела на `gap` метров от его ПОВЕРХНОСТИ, наружу от звезды.
 *
 * Наружу — потому что внутрь означало бы выйти между миром и его светилом:
 * планета встала бы чёрным диском поперёк всего кадра, а причал спрятался за ней.
 */
function standoff(from: Point3, radius: number, star: Point3, gap: number): Point3 {
  const dx = from[0] - star[0]
  const dy = from[1] - star[1]
  const dz = from[2] - star[2]
  const length = Math.hypot(dx, dy, dz)
  // Тело в самой звезде — направление не определено. Уходим по X: он не хуже прочих.
  const [ux, uy, uz] = length > 1e-6 ? [dx / length, dy / length, dz / length] : [1, 0, 0]
  const out = radius + gap
  return [from[0] + ux * out, from[1] + uy * out, from[2] + uz * out]
}

/**
 * Где корабль окажется. `null` — там же, где и раньше: у столицы.
 *
 * У планеты со станцией отсчёт идёт от СТАНЦИИ: лететь пилот будет к причалу,
 * и минута пути должна остаться до него, а не до планеты, вокруг которой он висит.
 */
export function arrivalPoint(def: SystemDef, arrival: Arrival | null): Point3 {
  if (!arrival) return def.playerStart

  if (arrival.kind === 'point') {
    const bounds = arrivalBounds(def)
    if (!bounds) return def.playerStart
    const orbit = Math.min(bounds.max, Math.max(bounds.min, arrival.orbit))
    return [
      def.star.pos[0] + orbit * Math.cos(arrival.angle),
      def.star.pos[1],
      def.star.pos[2] + orbit * Math.sin(arrival.angle),
    ]
  }

  const planet = def.planets[arrival.planet]
  if (!planet) return def.playerStart

  const station = def.station
  if (station && stationSeat(def) === arrival.planet) {
    return standoff(station.pos, station.radius, def.star.pos, ARRIVAL.STANDOFF)
  }
  return standoff(planet.pos, planet.radius, def.star.pos, ARRIVAL.STANDOFF)
}
