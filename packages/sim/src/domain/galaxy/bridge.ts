import { MOON } from '../../config/bodies'
import { PLANET_COLORS, SCALE } from '../../config/galaxy'
import { makeRng } from '../../core/math'
import type { PatrolDef, SystemDef } from '../world/system'
import { capitalOf, type Planet, type StarSystem } from './types'

/**
 * Мост между КАРТОЙ и МИРОМ.
 *
 * Генератор галактики оперирует безразмерными числами: радиус звезды 1100,
 * орбита 6000·1.7ⁱ. Мир живёт в настоящих метрах — Земля 6371 км, астрономическая
 * единица 1.5·10¹¹ м. Перевод — здесь и только здесь.
 *
 * Это и есть тот шов, который был обещан комментарием в `system.ts`: «со временем
 * это будет строиться из StarSystem». Симуляция не меняется ни на строчку — она
 * как принимала `SystemDef`, так и принимает.
 */

/** Золотой угол: планеты не выстраиваются в линию и не слипаются на карте. */
const GOLDEN_ANGLE = 2.399963

/**
 * Вращение и наклон оси. Генератор их не хранит — да и не должен: это свойства
 * рендера, а не экономики. Выводим из индекса, чтобы мир оставался детерминирован.
 */
function spinOf(index: number): { spin: number; tilt: number } {
  // Земные сутки — 7.27e-5 рад/с. Дальние миры крутятся быстрее, как газовые гиганты.
  const spin = 7.27e-5 * (1 + index * 0.35)
  return { spin: index % 2 === 0 ? spin : -spin, tilt: 0.05 + index * 0.09 }
}

function planetPos(planet: Planet, index: number): [number, number, number] {
  const r = planet.orbit * SCALE.ORBIT
  const a = index * GOLDEN_ANGLE
  // Орбиты слегка наклонены: плоская система выглядит нарисованной.
  return [r * Math.cos(a), r * Math.sin(a) * 0.06, r * Math.sin(a)]
}

/**
 * Сколько пиратов встретит гость. Охрана пространства — свойство системы,
 * и она уже посчитана генератором из строя самого населённого мира.
 */
function patrolsFor(system: StarSystem, near: readonly [number, number, number]): PatrolDef[] {
  const count =
    system.security === 'Нет' ? 3 : system.security === 'Низкая' ? 2 : system.security === 'Средняя' ? 1 : 0
  if (count === 0) return []

  // Трое сразу — не бой, а казнь: разводим их так же, как в стартовой системе.
  const patrols: PatrolDef[] = [
    { count: 1, at: [near[0] + 1_400, near[1] + 200, near[2] + 2_600], spread: 150, faction: 'hostile', name: 'Пират' },
  ]
  if (count > 1) {
    patrols.push({
      count: count - 1,
      at: [near[0] - 3_000, near[1] - 800, near[2] + 6_500],
      spread: 400,
      faction: 'hostile',
      name: 'Пират',
    })
  }
  return patrols
}

/**
 * Куда выходит корабль после прыжка.
 *
 * К причалу, если он есть: подлетать всегда к миру, а не к абстрактной точке.
 * Иначе — к главной планете. Если жить негде совсем, выходим в паре а.е. от
 * звезды: не внутри неё и не там, откуда до неё лететь крейсером полчаса.
 */
function arrivalPoint(system: StarSystem, seat: number, planets: SystemDef['planets']): [number, number, number] {
  const planet = planets[seat]
  if (!planet) return [0, 0, -2 * SCALE.AU]

  const station = system.planets[seat]?.station
  const altitude = station ? station.orbit * SCALE.STATION_ORBIT : planet.radius * 1.6
  // Две тысячи метров позади причала: он сразу в кадре, нос смотрит в −Z.
  return [planet.pos[0] + planet.radius + altitude, planet.pos[1], planet.pos[2] + 2_000]
}

/**
 * Луны в метрах. Радиус орбиты генератор хранит в радиусах своей планеты —
 * так он не зависит от масштаба, которым мир переведут в метры.
 *
 * Фаза берётся золотым углом, а не броском кости: две луны одной планеты
 * обязаны разойтись, а не слипнуться, и делать это они должны одинаково в любой
 * системе. Наклон растёт с номером: дальняя луна всегда самая «косая».
 */
function moonsOf(planet: Planet, radius: number): SystemDef['planets'][number]['moons'] {
  return planet.moons.map((m, i) => ({
    name: m.name,
    radius: m.radius * SCALE.PLANET_RADIUS,
    orbit: m.orbit * radius,
    phase: i * GOLDEN_ANGLE,
    tilt: MOON.MAX_TILT * ((i + 1) / (planet.moons.length + 1)),
  }))
}

/** Система карты, развёрнутая в мир. Детерминирована: индекс и зерно задают всё. */
export function systemDefOf(system: StarSystem, galaxySeed: number): SystemDef {
  const rng = makeRng(galaxySeed ^ (system.index + 1))

  const planets = system.planets.map((p, i) => {
    const radius = p.radius * SCALE.PLANET_RADIUS
    return {
      name: p.name,
      type: p.type,
      pos: planetPos(p, i),
      radius,
      color: PLANET_COLORS[p.type],
      // Ноль у необитаемого мира. Ночную сторону красит рендер, но КТО там живёт —
      // знает галактика, и она же одна имеет право это сказать.
      population: p.settlement?.population ?? 0,
      moons: moonsOf(p, radius),
      ...spinOf(i),
    }
  })

  const starRadius = system.star.radius * SCALE.STAR_RADIUS
  /**
   * Спутник двойной. Расстояние между центрами — несколько сумм радиусов:
   * ближе они бы касались (контактная пара), дальше — уже не читались бы как
   * одна система. Число детерминировано: та же система при том же зерне.
   */
  const companion = system.companion
    ? {
        radius: system.companion.radius * SCALE.STAR_RADIUS,
        color: system.companion.color,
        separation: (starRadius + system.companion.radius * SCALE.STAR_RADIUS) * (3 + rng() * 4),
      }
    : null

  // Столица — мир с причалом и наибольшим населением. К ней и выходим.
  const capital = capitalOf(system)
  const seat = capital ? system.planets.indexOf(capital) : 0

  const start = arrivalPoint(system, seat, planets)
  const capitalPlanet = planets[seat]
  const stationDef = capital?.station && capitalPlanet
    ? {
        name: capital.station.name,
        pos: [start[0], start[1], start[2] - 2_000] as [number, number, number],
        radius: 400,
      }
    : null

  return {
    name: system.name,
    seed: Math.floor(rng() * 2 ** 31),
    playerStart: start,
    star: { pos: [0, 0, 0], radius: starRadius, color: system.star.color },
    companion,
    dyson: system.dyson,
    planets,
    station: stationDef,
    // Пояс есть не везде: он локален и живёт в масштабе километров, как бой.
    belt: system.planets.length > 2
      ? { center: [start[0] + 6_000, start[1], start[2] + 8_000], radius: 3_000, count: 220 }
      : null,
    patrols: patrolsFor(system, start),
  }
}
