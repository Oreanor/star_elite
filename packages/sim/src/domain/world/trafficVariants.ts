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
import { withUpgrade } from '../station/moduleState'
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

/**
 * Полоса прокачки трафика. Это НЕ автолевел: профиль привязан к роли борта,
 * а бросок независим от игрока и от расстояния до центра. Поэтому в одном
 * коридоре могут встретиться и стоковый слабый пират, и редкий ветеран.
 */
const UPGRADE_BAND: Readonly<Record<string, readonly [number, number]>> = {
  trader: [0, 0.2],
  convoy: [0, 0.3],
  freighter: [0, 0.35],
  police: [0.1, 0.55],
  pirate: [0, 0.65],
  gang: [0, 0.75],
  raider: [0.2, 0.9],
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
  const stock = entry.loadout()
  const band = UPGRADE_BAND[kindId] ?? [0, 0.2]
  const level = band[0] + rng() * (band[1] - band[0])
  // Каталожные модули общие и неизменяемые: прокачка всегда получает клон.
  const loadout: Loadout = {
    chassis: stock.chassis,
    internals: stock.internals.map((module) => withUpgrade(module, level)),
    weapons: stock.weapons.map((module) => (module ? withUpgrade(module, level) as typeof module : null)),
  }
  return { loadout, profession: entry.profession }
}
