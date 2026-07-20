import { GALAXY } from '../../config/galaxy'
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

function isSharedStart(index: number, galaxySeed: number): boolean {
  return index === SHARED_START_INDEX && galaxySeed === GALAXY.SEED
}

/** Каталог карты: у общего старта своё ИМЯ СИСТЕМЫ, причал — как у всех. */
export function applySharedStartCatalog(system: StarSystem, galaxySeed: number): StarSystem {
  if (!isSharedStart(system.index, galaxySeed)) return system
  return { ...system, name: SYSTEM_NAME }
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
    blackHoles: [{ name: DOOR_NAME, radius: 300, stationOffset: [0, 0, 60_000] }],
  }
}
