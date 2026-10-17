import { MOON } from '../../config/bodies'
import { PLANET_COLORS, SCALE } from '../../config/galaxy'
import { makeRng } from '../../core/math'
import { STATION_RADIUS } from '../world/system'
import type { PatrolDef, SystemDef } from '../world/system'
import { PULSAR } from '../../config/beams'
import { quasarOf } from './quasar'
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
 * Особое светило: чёрная дыра ядра (класс H) или пульсар (класс N). Обычным звёздам — ничего.
 *
 * Дыра ядра квазарной галактики (`quasarOf`) получает джеты вдоль оси диска; у спокойной ось
 * диска фиксированная, чуть наклонённая: ребром диск не виден вовсе, плашмя — плоская шайба,
 * а под углом читается и диск, и тень.
 *
 * Пульсар: ось вращения и наклонённая к ней магнитная ось, вдоль которой бьют лучи; период —
 * из своего подзерна системы, чтобы бросок не сдвигал остальную случайность системы.
 */
function lightOf(system: StarSystem, galaxySeed: number): Pick<SystemDef['star'], 'blackHole' | 'pulsar'> {
  if (system.star.class === 'H') {
    const jets = quasarOf(galaxySeed)
    return { blackHole: jets ? { diskAxis: jets, jets: true } : { diskAxis: [0.25, 1, 0.15] } }
  }
  if (system.star.class !== 'N') return {}
  const rng = makeRng((galaxySeed ^ Math.imul(system.index + 1, 0x50554c53)) >>> 0)
  // Ось вращения — случайная по сфере; магнитная — отклонена от неё на угол наклона.
  const z = rng() * 2 - 1
  const a = rng() * Math.PI * 2
  const r = Math.sqrt(1 - z * z)
  const spin: [number, number, number] = [r * Math.cos(a), z, r * Math.sin(a)]
  // Любой вектор, не параллельный оси, — для перпендикуляра.
  const ref: [number, number, number] = Math.abs(spin[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const px = spin[1] * ref[2] - spin[2] * ref[1]
  const py = spin[2] * ref[0] - spin[0] * ref[2]
  const pz = spin[0] * ref[1] - spin[1] * ref[0]
  const pl = Math.hypot(px, py, pz)
  const inc = PULSAR.INCLINATION_MIN + rng() * (PULSAR.INCLINATION_MAX - PULSAR.INCLINATION_MIN)
  const c = Math.cos(inc)
  const sn = Math.sin(inc)
  const beam: [number, number, number] = [
    spin[0] * c + (px / pl) * sn,
    spin[1] * c + (py / pl) * sn,
    spin[2] * c + (pz / pl) * sn,
  ]
  const period = PULSAR.PERIOD_MIN + rng() * (PULSAR.PERIOD_MAX - PULSAR.PERIOD_MIN)
  return { pulsar: { spinAxis: spin, beamAxis: beam, period } }
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
        massSolar: system.companion.massSolar,
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
        radius: STATION_RADIUS,
        model: stationModel,
        planet: seat,
      }
    : null

  /**
   * ОСТАЛЬНЫЕ ПРИЧАЛЫ системы. Станция — свойство заселённой планеты, и обитаемых миров
   * в системе бывает несколько; раньше в мир попадал только тот, к которому выходишь, и
   * соседние причалы существовали лишь в каталоге. Теперь они стоят телами на своих
   * орбитах: долететь можно до любого, а место выхода остаётся одно (`seat`).
   *
   * Облик выводим из того же сида, но со сдвигом по номеру планеты: два причала одной
   * системы не должны оказаться близнецами, и при этом «какой где» обязано совпадать
   * у всех клиентов — общий сид, никакого броска на месте.
   */
  const extraStations = system.planets.flatMap((p, i) => {
    if (i === seat || !p.station) return []
    const planet = planets[i]
    if (!planet) return []
    const altitude = p.station.orbit * SCALE.STATION_ORBIT
    return [
      {
        name: p.station.name,
        pos: [planet.pos[0] + planet.radius + altitude, planet.pos[1], planet.pos[2]] as [number, number, number],
        radius: STATION_RADIUS,
        model: Math.floor(makeRng(seed ^ (0x53_54_4e + i))() * 5),
        planet: i,
      },
    ]
  })

  return {
    name: system.name,
    seed,
    playerStart: start,
    star: {
      pos: [0, 0, 0],
      radius: starRadius,
      color: system.star.color,
      massSolar: system.star.massSolar,
      ...lightOf(system, galaxySeed),
    },
    companion,
    dyson: system.dyson,
    planets,
    station: stationDef,
    extraStations,
    // Камни — встречи трафика, не хардкод-пояс у старта.
    belt: null,
    patrols: patrolsFor(system, start),
  }
}
