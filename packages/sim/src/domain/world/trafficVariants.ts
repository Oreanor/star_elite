import {
  auroraOneLoadout,
  freighterLoadout,
  hermesLoadout,
  orionLoadout,
  pegasusLoadout,
  perseusLoadout,
  pirateLeaderLoadout,
  pirateLoadout,
  theseusLoadout,
  traderLoadout,
} from '../../config/loadouts'
import type { Rng } from '../../core/math'
import type { Loadout } from '../loadout'
import type { Profession } from './persona'

/**
 * Варианты борта для типа встречи: корпус и род занятий. Один «торговец» в таблице
 * встреч — это роль в трафике; на радаре и в разговоре видны разные корабли и профессии.
 *
 * Все корпуса — загруженные GLB-модели (процедурные сняты из игры): гражданские садятся на
 * «Пегас»/«Тесей»/«Аврору One», боевые — на «Гермес»/«Орион» и стоковые пиратские сборки.
 */

interface VariantEntry {
  readonly weight: number
  readonly loadout: () => Loadout
  readonly profession: Profession
}

const CIVIL_MIX: readonly VariantEntry[] = [
  { weight: 18, loadout: pegasusLoadout, profession: 'businessman' },
  { weight: 16, loadout: theseusLoadout, profession: 'explorer' },
  { weight: 14, loadout: auroraOneLoadout, profession: 'traveler' },
  { weight: 12, loadout: traderLoadout, profession: 'businessman' },
]

const BY_KIND: Record<string, readonly VariantEntry[]> = {
  trader: CIVIL_MIX,
  convoy: CIVIL_MIX,
  freighter: [{ weight: 1, loadout: freighterLoadout, profession: 'businessman' }],
  police: [
    { weight: 32, loadout: perseusLoadout, profession: 'military' },
    { weight: 28, loadout: orionLoadout, profession: 'military' },
    { weight: 18, loadout: pirateLeaderLoadout, profession: 'military' },
  ],
  pirate: [
    { weight: 34, loadout: pirateLoadout, profession: 'pirate' },
    { weight: 26, loadout: hermesLoadout, profession: 'pirate' },
    { weight: 22, loadout: theseusLoadout, profession: 'pirate' },
  ],
  gang: [
    { weight: 40, loadout: pirateLoadout, profession: 'pirate' },
    { weight: 30, loadout: hermesLoadout, profession: 'pirate' },
  ],
  raider: [
    { weight: 38, loadout: pirateLeaderLoadout, profession: 'pirate' },
    { weight: 32, loadout: orionLoadout, profession: 'pirate' },
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
