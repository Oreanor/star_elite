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

export function isSharedStart(index: number, galaxySeed: number): boolean {
  return index === SHARED_START_INDEX && galaxySeed === GALAXY.SEED
}

/**
 * Каталог карты: у общего старта своё ИМЯ СИСТЕМЫ, остальное — из зерна, как у всех. Ручных
 * тел здесь нет: витрины (Сатурн, «Дверь» у причала, тесные пары, базы двора) убраны — вход на
 * куст галактик живёт в ядре галактики, базы и пары рождает генерация.
 */
export function applySharedStartCatalog(system: StarSystem, galaxySeed: number): StarSystem {
  if (!isSharedStart(system.index, galaxySeed)) return system
  return { ...system, name: SYSTEM_NAME }
}

/** Мир общего старта — то же имя системы; тела и станция — из зерна. */
export function applySharedStartWorld(def: SystemDef, index: number, galaxySeed: number): SystemDef {
  if (!isSharedStart(index, galaxySeed)) return def
  return { ...def, name: SYSTEM_NAME }
}
