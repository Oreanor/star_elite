import { MOON } from '../../config/bodies'
import { LUCIFER, PLANET_COLORS, SCALE } from '../../config/galaxy'
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

/**
 * Система карты, развёрнутая в мир. Детерминирована: индекс и зерно задают всё.
 *
 * `seatOverride` — планета с причалом, ВЫБРАННАЯ игроком на карте, когда станций
 * в системе несколько. Мир строит именно её станцию (и выход к ней), а не столичную
 * по умолчанию. Если у выбранной планеты станции нет — молча берём столицу.
 */
export function systemDefOf(system: StarSystem, galaxySeed: number, seatOverride?: number): SystemDef {
  const rng = makeRng(galaxySeed ^ (system.index + 1))

  // ЛЮЦИФЕР — одинокая звезда-гигант в пустоте: планет и пояса нет. Прибытие масштабируем ОТ
  // РАДИУСА: выходим на 2.4×R от центра — чуть выше зоны жара (SAFE_RATIO=1.2 над поверхностью
  // = 2.2×R) и вне притяжения, но звезда во всё небо. По оси к светилу выстроена процессия:
  // причал-ВЕЕР (солнечная станция, док), за ним КРЕСТ («бог в центре вселенной», с ботом
  // Словом), и дальше пылает сам Люцифер. Нос в −Z. Честная физика, без «приручения» жара.
  if (system.index === LUCIFER.INDEX) {
    const r = system.star.radius * SCALE.STAR_RADIUS
    // Причалы стоят ВДЕСЯТЕРО дальше от звезды, чем прежде (24×R вместо 2.4×R): гигант
    // больше не нависает над станциями, а горит в глубине кадра ровным диском. Игрок
    // выходит рядом с причалами (нос в −Z, к звезде), а не в жерло короны.
    const dist = r * 24
    return {
      name: system.name,
      seed: Math.floor(rng() * 2 ** 31),
      playerStart: [0, 0, dist],
      star: { pos: [0, 0, 0], radius: r, color: system.star.color },
      companion: null,
      dyson: null,
      planets: [],
      // Основной причал — «солнечный веер», вдесятеро крупнее кориолиса (radius 400 → 4000).
      station: { name: 'Причал «Веер»', pos: [0, 0, dist - 16_000], radius: 4_000, style: 'solar' },
      // Крест-храм — ВДЕСЯТЕРО крупнее (radius 6000→60000): исполинский монумент с лучами из
      // концов. Отодвинут глубже к звезде (dist−90000), чтобы 60-км крест не накрыл 4-км Веер:
      // расстояние центров 74 км > 60+4 км суммы радиусов. На нём — Слово.
      extraStations: [{ name: 'Крест «Вечность»', pos: [0, 0, dist - 90_000], radius: 60_000, style: 'cross' }],
      belt: null,
      patrols: [],
      // Бездна: ни трафика, ни завсегдатаев — пусто, только Люцифер и бог на Кресте.
      desolate: true,
    }
  }

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
      // Поселение — как есть, per-planet: аграрная колония и промышленная столица
      // в одной системе имеют каждая своё. Рынок причала возьмёт экономику отсюда.
      settlement: p.settlement,
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

  // Столица — мир с причалом и наибольшим населением. К ней и выходим по умолчанию;
  // но если игрок выбрал на карте другую станцию системы — местом выхода становится она.
  const capital = capitalOf(system)
  const defaultSeat = capital ? system.planets.indexOf(capital) : 0
  const seat =
    seatOverride != null && system.planets[seatOverride]?.station ? seatOverride : defaultSeat

  const seatStation = system.planets[seat]?.station ?? null
  const start = arrivalPoint(system, seat, planets)
  const seatPlanet = planets[seat]
  // Сид системы фиксируем ДО станции: из него же выводим детерминированный облик причала,
  // чтобы «где какая» не зависело от пути прибытия и совпадало у всех клиентов (общий сид).
  const seed = Math.floor(rng() * 2 ** 31)
  // Пять GLB-обликов станций (рендер берёт по модулю фактического числа — расхождение безопасно).
  const stationModel = Math.floor(makeRng(seed ^ 0x53_54_4e)() * 5)
  const stationDef = seatStation && seatPlanet
    ? {
        name: seatStation.name,
        pos: [start[0], start[1], start[2] - 2_000] as [number, number, number],
        radius: 400,
        model: stationModel,
      }
    : null

  return {
    name: system.name,
    seed,
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
