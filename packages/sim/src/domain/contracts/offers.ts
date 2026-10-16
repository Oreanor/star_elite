import { CONTRACTS } from '../../config/contracts'
import { CONTACTS } from '../../config/contacts'
import { CORE_INDEX, GALAXY } from '../../config/galaxy'
import { roundMoney, weightedPick, type Rng } from '../../core/math'
import { COMMODITIES, type Commodity } from '../cargo/items'
import { generateSystem } from '../galaxy/generate'
import { distanceLy, placeSystem, type Spot3 } from '../galaxy/shape'
import type { ShipEntity, World } from '../world/entities'
import type { ContractKind, ContractOffer } from './types'

/**
 * ОФЕРТЫ. Кто что предлагает — ТАБЛИЦА по роли (`originKind`), а не лестница условий:
 * торговец просит отвезти и привезти, патруль — убрать пиратов и снести гнездо. Новая роль —
 * новая строка, симуляция не меняется.
 *
 * Оферта бросается ПРИ РОЖДЕНИИ борта от `world.rng` (зерно системы): у тех же бортов те же
 * дела. Спасение — особое: оно не бросается, а случается (на торговца напали, см. `rescueOffer`).
 */

interface Row {
  readonly kind: Exclude<ContractKind, 'rescue'>
  readonly weight: number
}

const BY_ROLE: Readonly<Record<string, readonly Row[]>> = {
  trader: [
    { kind: 'deliver', weight: 45 },
    { kind: 'fetch', weight: 35 },
    { kind: 'escort', weight: 20 },
  ],
  convoy: [
    { kind: 'deliver', weight: 50 },
    { kind: 'escort', weight: 50 },
  ],
  freighter: [{ kind: 'deliver', weight: 1 }],
  police: [
    { kind: 'hunt', weight: 60 },
    { kind: 'demolish', weight: 40 },
  ],
}

/** Ходовой легальный товар — его и возят по делам. Контрабанда — дело пиратов, не торговцев. */
const GOODS: readonly Commodity[] = [
  COMMODITIES.FOOD,
  COMMODITIES.MINERALS,
  COMMODITIES.METALS,
  COMMODITIES.MACHINERY,
  COMMODITIES.ELECTRONICS,
]

export function commodityById(id: string): Commodity | null {
  return Object.values(COMMODITIES).find((c) => c.id === id) ?? null
}

const between = (rng: Rng, [lo, hi]: readonly [number, number]): number => lo + Math.floor(rng() * (hi - lo + 1))

// Положения систем галактики — по зерну. Считать их дорого (десять тысяч), а нужны они
// при каждой оферте с дорогой; это чистые данные от зерна, кэш их не портит.
let _positionsSeed = NaN
let _positions: Spot3[] = []
function positions(seed: number): Spot3[] {
  if (seed !== _positionsSeed) {
    _positions = Array.from({ length: GALAXY.COUNT }, (_, i) => placeSystem(i, seed))
    _positionsSeed = seed
  }
  return _positions
}

/**
 * Куда везти: соседняя система СО СТАНЦИЕЙ в пределах одного прыжка игрока (без привода —
 * в пределах перелёта знакомого). Порядок кандидатов — от кости, выбор детерминирован.
 */
export function pickDestination(world: World, rng: Rng): { index: number; name: string; ly: number } | null {
  const all = positions(world.galaxySeed)
  const here = all[world.systemIndex]
  if (!here) return null
  const range = world.player.spec.jumpRange > 0 ? world.player.spec.jumpRange : CONTACTS.WANDER_RANGE_LY
  const near: number[] = []
  for (let i = 0; i < all.length; i++) {
    if (i === world.systemIndex || i === CORE_INDEX) continue
    if (distanceLy(here, all[i]!) <= range) near.push(i)
  }
  // Перебираем с места, выпавшего костью, — один бросок, а не по броску на кандидата.
  const start = Math.floor(rng() * Math.max(1, near.length))
  for (let k = 0; k < near.length; k++) {
    const index = near[(start + k) % near.length]!
    const system = generateSystem(index, world.galaxySeed)
    if (system.planets.some((p) => p.station)) {
      return { index, name: system.name, ly: distanceLy(here, all[index]!) }
    }
  }
  return null
}

/** Расстояние для речи и карточки, св.лет: десятые — точнее не говорят. */
const roundLy = (ly: number) => Math.round(ly * 10) / 10


/** Бросить оферту новорождённому борту. null — дела у него нет (так чаще всего). */
export function rollOffer(world: World, ship: ShipEntity): ContractOffer | null {
  const table = BY_ROLE[ship.originKind ?? '']
  if (!table) return null
  const rng = world.rng
  if (rng() >= CONTRACTS.OFFER_SHARE) return null
  const row = weightedPick(rng, table, (r) => r.weight)

  switch (row.kind) {
    case 'deliver': {
      const dest = pickDestination(world, rng)
      if (!dest) return null
      const good = GOODS[Math.floor(rng() * GOODS.length)]!
      const units = between(rng, CONTRACTS.DELIVER_UNITS)
      const reward = roundMoney(
        CONTRACTS.DELIVER_BASE + units * good.basePrice * CONTRACTS.DELIVER_CARGO_SHARE + dest.ly * CONTRACTS.DELIVER_PER_LY,
      )
      const days = Math.ceil(CONTRACTS.DAYS_DELIVER + dest.ly * CONTRACTS.DAYS_PER_LY)
      return { kind: 'deliver', commodityId: good.id, units, toSystem: dest.index, toSystemName: dest.name, ly: roundLy(dest.ly), reward, days, revealed: false }
    }
    case 'fetch': {
      // Привезти можно лишь туда, где есть причал: сдают на станции этой системы.
      if (!world.bodies.some((b) => b.kind === 'station')) return null
      const good = GOODS[Math.floor(rng() * GOODS.length)]!
      const units = between(rng, CONTRACTS.FETCH_UNITS)
      const reward = roundMoney(good.basePrice * CONTRACTS.FETCH_MARKUP)
      return { kind: 'fetch', commodityId: good.id, units, reward, days: CONTRACTS.DAYS_FETCH, revealed: false }
    }
    case 'escort': {
      const dest = pickDestination(world, rng)
      if (!dest) return null
      const reward = roundMoney(CONTRACTS.ESCORT_BASE + dest.ly * CONTRACTS.ESCORT_PER_LY)
      return { kind: 'escort', toSystem: dest.index, toSystemName: dest.name, ly: roundLy(dest.ly), reward, days: CONTRACTS.DAYS_ESCORT, revealed: false }
    }
    case 'hunt': {
      const heads = between(rng, CONTRACTS.HUNT_HEADS)
      return { kind: 'hunt', heads, reward: CONTRACTS.HUNT_PER_HEAD, days: null, revealed: false }
    }
    case 'demolish':
      return { kind: 'demolish', reward: CONTRACTS.DEMOLISH_REWARD, days: null, revealed: false }
  }
}

/**
 * Спасение: на мирного напали, и он зовёт на помощь. Не бросок кости, а событие мира —
 * награда растёт с числом нападающих.
 */
export function rescueOffer(attackers: readonly ShipEntity[]): ContractOffer {
  return {
    kind: 'rescue',
    attackers: attackers.map((a) => a.id),
    reward: CONTRACTS.RESCUE_BASE + CONTRACTS.RESCUE_PER_ATTACKER * attackers.length,
    days: null,
    revealed: true,
  }
}
