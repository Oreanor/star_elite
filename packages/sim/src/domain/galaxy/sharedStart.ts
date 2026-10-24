import { GALAXY, SCALE } from '../../config/galaxy'
import type { SystemDef } from '../world/system'
import type { StarSystem } from './types'

/**
 * Онлайн-спавн / дом при родном зерне: индекс 1 — «Люрилар».
 * Правки старта живут здесь (не в тестовом STARTER_SYSTEM).
 *
 * Причал тут ОБЫЧНЫЙ. Крест «Кресты» отсюда уехал: он монумент ЦЕНТРУ ВСЕЛЕННОЙ и стоит
 * в корне куста галактик (узел 0), а не в первой попавшейся жилой системе. Домашняя
 * галактика — узел `GALAXY.HOME_NODE`, то есть даже не корень; ставить главный монумент
 * вселенной у себя во дворе значило бы обесценить и его, и дорогу к нему.
 */
export const SHARED_START_INDEX = 1 as const

const SYSTEM_NAME = 'Люрилар'
/** Вход на куст галактик. Одна на всю игру — там, где игрок начинает. */
const DOOR_NAME = 'Дверь'
const PREVIEW_PLANET = 'Сатурн'
/** Радиус временного Сатурна, м. */
const PREVIEW_RADIUS = 58_232_000

export function isSharedStart(index: number, galaxySeed: number): boolean {
  return index === SHARED_START_INDEX && galaxySeed === GALAXY.SEED
}

/** Каталог карты: у общего старта своё ИМЯ СИСТЕМЫ, причал — как у всех. */
export function applySharedStartCatalog(system: StarSystem, galaxySeed: number): StarSystem {
  if (!isSharedStart(system.index, galaxySeed)) return system
  return {
    ...system,
    name: SYSTEM_NAME,
    // ВРЕМЕННО: витрина есть и в каталоге, чтобы карта и сцена перечисляли одни миры.
    planets: [...system.planets, {
      name: PREVIEW_PLANET,
      type: 'Газовый гигант',
      radius: PREVIEW_RADIUS / SCALE.PLANET_RADIUS,
      orbit: system.planets.find((p) => p.station)?.orbit ?? 1,
      moons: [],
      settlement: null,
      station: null,
    }],
  }
}

/**
 * Мир: то же имя системы плюс ДВЕРЬ. Станция генерируется наравне с прочими.
 *
 * «Дверь» — чёрный шарик у причала, вход на куст галактик.
 *
 * ХАРДКОД НА ВРЕМЯ РАЗРАБОТКИ. По замыслу дверь одна на галактику и стоит в ЕЁ ЦЕНТРЕ —
 * это чёрная дыра ядра (`CORE_INDEX`), она уже есть в каждой галактике и лететь к ней надо
 * через всю систему. Здешний шарик у причала существует лишь затем, чтобы попадать на куст
 * за десять секунд, а не за рейс. Поедут рельсы — убрать, вход останется ядром.
 *
 * Шестьдесят километров от причала, а не «пара тысяч рядом»: игрок появляется в двух
 * километрах от станции, и дыра под боком возмущала бы гравитацией всё, что там летает —
 * ракеты уводило бы с курса, борта тормозило. Отсюда её видно чёрной точкой у станции,
 * но ни в стыковку, ни в бой она не вмешивается.
 */
export function applySharedStartWorld(def: SystemDef, index: number, galaxySeed: number): SystemDef {
  if (!isSharedStart(index, galaxySeed)) return def
  return {
    ...def,
    name: SYSTEM_NAME,
    // ВРЕМЕННО: Сатурн для осмотра колец со стартового причала. Удалить после просмотра.
    // Центр в четырёх радиусах: кольца целиком в небе, причал далеко от поверхности.
    planets: def.planets.map((p) => p.name !== PREVIEW_PLANET ? p : {
      ...p,
      pos: def.station?.pos ?? def.playerStart,
      stationOffset: [100_000_000, 80_000_000, -220_000_000] as const,
      color: 0xcbb994,
      spin: 0.000164,
      tilt: 0.47,
    }),
    // ВРЕМЕННО для теста: Дверь — квазар (джеты вертикально, мимо станции). Снять `jets`.
    blackHoles: [{ name: DOOR_NAME, radius: 300, stationOffset: [0, 0, 60_000], jets: true }],
    // ВРЕМЕННО для теста: тесная пара с перетеканием вещества в ~260 км от причала, в стороне
    // от Двери и баз. Голубой гигант-донор и белый компаньон с диском. Убрать после проверки.
    streamPairs: [
      {
        name: 'Близнецы',
        stationOffset: [-220_000, 30_000, -130_000],
        donor: { radius: 26_000, color: 0x9fd4ff },
        accretor: { radius: 7_000, color: 0xeaf6ff },
        separation: 95_000,
      },
      // Вторая — «гантелька»: газ по прямой, воронками у обеих звёзд.
      {
        name: 'Гантели',
        style: 'straight',
        stationOffset: [-160_000, -40_000, 260_000],
        donor: { radius: 22_000, color: 0xffc89a },
        accretor: { radius: 14_000, color: 0xfff0d8 },
        separation: 85_000,
      },
    ],
    // Четыре военные базы на снос у причала, каждая со своей техно-картой (model → текстура).
    // Разнесены в стороны от станции и от «Двери» (та в +Z на 60 км), чтобы не толпиться.
    warBases: [
      { name: 'База «Редут»', radius: 1_000, stationOffset: [18_000, 0, -6_000], model: 0 },
      { name: 'База «Бастион»', radius: 3_000, stationOffset: [-32_000, 4_000, -14_000], model: 1 },
      { name: 'База «Форпост»', radius: 1_500, stationOffset: [6_000, -9_000, 22_000], model: 2 },
      { name: 'База «Цитадель»', radius: 2_200, stationOffset: [-14_000, 11_000, 8_000], model: 3 },
    ],
  }
}
