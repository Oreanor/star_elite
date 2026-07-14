import { AURORA_MK3, SIDEWINDER } from '../../config/chassis'
import {
  apolloLoadout,
  aresLoadout,
  artemisLoadout,
  athenaLoadout,
  freighterLoadout,
  pirateLeaderLoadout,
  pirateLoadout,
  traderLoadout,
} from '../../config/loadouts'
import {
  CARGO_LARGE,
  CARGO_SMALL,
  ENGINE_CIVILIAN,
  HYPERDRIVE_BASIC,
  PULSE_LASER_WORN,
  RCS_CIVILIAN,
  SHIELD_LIGHT,
  SHIELD_STANDARD,
} from '../../config/modules'
import type { Rng } from '../../core/math'
import { createLoadout, type Loadout } from '../loadout'
import type { Profession } from './persona'

/**
 * Варианты борта для типа встречи: корпус и род занятий. Один «торговец» в таблице
 * встреч — это роль в трафике; на радаре и в разговоре видны разные корабли и профессии.
 */

interface VariantEntry {
  readonly weight: number
  readonly loadout: () => Loadout
  readonly profession: Profession
}

/** Гражданский рейсовый на «Авроре» — не боевой стартовый комплект. */
function auroraCourierLoadout(): Loadout {
  return createLoadout(
    AURORA_MK3,
    [ENGINE_CIVILIAN, RCS_CIVILIAN, SHIELD_STANDARD, CARGO_LARGE, HYPERDRIVE_BASIC],
    [PULSE_LASER_WORN],
  )
}

/** Лёгкий курьер на «Аресе» с трюмом, без бронеплиты налётчика. */
function aresMerchantLoadout(): Loadout {
  return createLoadout(
    SIDEWINDER,
    [ENGINE_CIVILIAN, RCS_CIVILIAN, SHIELD_LIGHT, CARGO_SMALL, HYPERDRIVE_BASIC],
    [PULSE_LASER_WORN],
  )
}

const CIVIL_MIX: readonly VariantEntry[] = [
  { weight: 18, loadout: apolloLoadout, profession: 'traveler' },
  { weight: 16, loadout: athenaLoadout, profession: 'explorer' },
  { weight: 14, loadout: auroraCourierLoadout, profession: 'businessman' },
  { weight: 12, loadout: aresMerchantLoadout, profession: 'businessman' },
  { weight: 10, loadout: traderLoadout, profession: 'businessman' },
  { weight: 8, loadout: artemisLoadout, profession: 'military' },
]

const BY_KIND: Record<string, readonly VariantEntry[]> = {
  trader: CIVIL_MIX,
  convoy: CIVIL_MIX,
  freighter: [{ weight: 1, loadout: freighterLoadout, profession: 'businessman' }],
  police: [
    { weight: 32, loadout: artemisLoadout, profession: 'military' },
    { weight: 28, loadout: apolloLoadout, profession: 'military' },
    { weight: 22, loadout: athenaLoadout, profession: 'military' },
    { weight: 18, loadout: pirateLeaderLoadout, profession: 'military' },
  ],
  pirate: [
    { weight: 34, loadout: pirateLoadout, profession: 'pirate' },
    { weight: 26, loadout: aresLoadout, profession: 'pirate' },
    { weight: 22, loadout: apolloLoadout, profession: 'pirate' },
    { weight: 18, loadout: artemisLoadout, profession: 'pirate' },
  ],
  gang: [
    { weight: 40, loadout: pirateLoadout, profession: 'pirate' },
    { weight: 30, loadout: aresLoadout, profession: 'pirate' },
    { weight: 30, loadout: apolloLoadout, profession: 'pirate' },
  ],
  raider: [
    { weight: 38, loadout: pirateLeaderLoadout, profession: 'pirate' },
    { weight: 32, loadout: artemisLoadout, profession: 'pirate' },
    { weight: 30, loadout: aresLoadout, profession: 'pirate' },
  ],
}

function pickFromTable(rng: Rng, table: readonly VariantEntry[]): VariantEntry {
  let total = 0
  for (const entry of table) total += entry.weight
  let roll = rng() * total
  for (const entry of table) {
    roll -= entry.weight
    if (roll <= 0) return entry
  }
  return table[table.length - 1]!
}

/** Сборка и профессия для корабля данного типа встречи. */
export function pickTrafficVariant(kindId: string, rng: Rng): { loadout: Loadout; profession: Profession } {
  const table = BY_KIND[kindId] ?? CIVIL_MIX
  const entry = pickFromTable(rng, table)
  return { loadout: entry.loadout(), profession: entry.profession }
}
