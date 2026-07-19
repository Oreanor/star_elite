import { GALAXY } from '../../config/galaxy'
import type { SystemDef } from '../world/system'
import type { StarSystem } from './types'
import { capitalOf } from './types'

/**
 * Онлайн-спавн / дом при родном зерне: индекс 1 — «Люрилар», двойная.
 * Правки старта живут здесь (не в тестовом STARTER_SYSTEM).
 *
 * Причал — крест «Кресты» (голубой каркас в рендере).
 */
export const SHARED_START_INDEX = 1 as const

const SYSTEM_NAME = 'Люрилар'
const STATION_NAME = 'Кресты'

function isSharedStart(index: number, galaxySeed: number): boolean {
  return index === SHARED_START_INDEX && galaxySeed === GALAXY.SEED
}

/** Каталог карты: имя системы и станции столицы. */
export function applySharedStartCatalog(system: StarSystem, galaxySeed: number): StarSystem {
  if (!isSharedStart(system.index, galaxySeed)) return system
  const capital = capitalOf(system)
  return {
    ...system,
    name: SYSTEM_NAME,
    planets: system.planets.map((p) =>
      capital && p === capital && p.station
        ? { ...p, station: { ...p.station, name: STATION_NAME, type: 'Кориолис' as const } }
        : p,
    ),
  }
}

/** Мир: та же станция — стиль cross и имя «Кресты». */
export function applySharedStartWorld(def: SystemDef, index: number, galaxySeed: number): SystemDef {
  if (!isSharedStart(index, galaxySeed)) return def
  return {
    ...def,
    name: SYSTEM_NAME,
    station: def.station
      ? { ...def.station, name: STATION_NAME, style: 'cross', model: undefined }
      : null,
  }
}
