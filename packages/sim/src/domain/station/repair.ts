import { SERVICE, SHOP } from '../../config/station'
import { clamp, makeRng } from '../../core/math'
import type { Settlement } from '../galaxy/types'
import {
  type ShipModule,
} from '../loadout'
import type { ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'
import { hashModuleId, moduleFault, replaceInstalled, withFault } from './moduleState'
import { localSettlement } from './trade'

/**
 * Ремонт у мастеров станции: корпус и сломанные детали. Мастерская бывает трёх классов по
 * развитию планеты; чем сложнее деталь для мастера, тем выше риск, что он её испортит.
 */

// ─── Мастерская: класс по развитию планеты × класс чинимой вещи ───────────────
//
// Отменяет прежнее жёсткое «чинят только по своему уровню». Теперь мастер БЕРЁТСЯ за
// работу вероятностно: класс-1 (захолустье) уверенно чинит класс-1, но за класс-2 —
// как повезёт, а класс-3 «не видел и не умеет». Развитее мастер — выше шанс и шире охват.
// Провал корпус не чинит, а порой доламывает (урон растёт), но денег за провал не берут.

export function hullDamage(ship: ShipEntity): number {
  return Math.max(0, ship.spec.hull.hull - ship.hull)
}

/** Базовая цена ремонта корпуса, без скидки мастерской. Растёт с уроном. */
export function repairCost(ship: ShipEntity): number {
  return Math.ceil(hullDamage(ship) * SHOP.HULL_REPAIR_COST)
}

export type MasterClass = 1 | 2 | 3

export type RepairOutcome = 'repaired' | 'botched' | 'refused' | 'no-money' | 'nothing'

/** Класс мастерской по развитию поселения: захолустье→1, средняя→2, развитая→3. */
export function masterClass(settlement: Settlement): MasterClass {
  const t = settlement.techLevel
  if (t >= SERVICE.MIN_TECH_BY_CLASS[3]) return 3 // тех ≥9
  if (t >= SERVICE.MIN_TECH_BY_CLASS[2]) return 2 // тех ≥5
  return 1
}

/** Развитость ВНУТРИ тира мастера, 0..1 — двигает вероятность внутри вилки. */
export function masterDev(settlement: Settlement, m: MasterClass): number {
  const t = settlement.techLevel
  if (m === 3) return clamp((t - SERVICE.MIN_TECH_BY_CLASS[3]) / 6, 0, 1) // 9..15
  if (m === 2) return clamp((t - SERVICE.MIN_TECH_BY_CLASS[2]) / 3, 0, 1) // 5..8
  return clamp((t - SERVICE.MIN_TECH_BY_CLASS[1]) / 3, 0, 1) // 1..4
}

/**
 * Шанс УСПЕХА ремонта вещи класса `item` у мастера класса `m`, 0..1. Ноль — не берётся
 * («такого не видели»). Числа — прямо из задумки: мастер уверенно чинит свой класс и ниже,
 * тянется на класс выше с риском, а на два класса выше не берётся вовсе.
 */
export function repairChance(m: MasterClass, item: number, dev: number): number {
  if (item <= m) {
    if (m === 1) return 0.7 + 0.3 * dev // м1/кл1: 70–100%
    if (m === 2) return item < 2 ? 1 : 0.8 + 0.2 * dev // м2: кл1=100%, кл2 80–100%
    return item < 3 ? 1 : 0.9 + 0.1 * dev // м3: кл1–2=100%, кл3 90–100%
  }
  if (item - m === 1) {
    if (m === 1) return 0.1 + 0.3 * dev // м1 берётся за кл2: 10–40%, чаще портит
    if (m === 2) return 0.4 + 0.3 * dev // м2 за кл3: 40–70%
    return 0.3 + 0.3 * dev // м3 за кл4 (god-tier): редко и рискованно
  }
  return 0 // разрыв ≥2 класса — не берутся
}

export interface RepairQuote {
  master: MasterClass
  /** Класс чинимой вещи. Для корпуса — класс корпуса. */
  itemClass: number
  /** Шанс успеха, 0..1. Ноль — тут за это не берутся. */
  chance: number
  /** Цена ПРИ УСПЕХЕ, со скидкой тира. При провале денег не берут. */
  price: number
}

/** Расклад ремонта КОРПУСА здесь: кто чинит, с каким шансом и почём при успехе. */
export function repairQuote(world: World, ship: ShipEntity): RepairQuote {
  const settlement = localSettlement(world)
  const master = masterClass(settlement)
  const itemClass = ship.loadout.chassis.class
  const chance = repairChance(master, itemClass, masterDev(settlement, master))
  const price = Math.ceil(repairCost(ship) * SHOP.REPAIR_TIER_PRICE[master])
  return { master, itemClass, chance, price }
}

/**
 * Ремонт корпуса БРОСКОМ (см. `repairQuote`). Успех — корпус в норму, деньги списаны.
 * Провал — денег НЕ берут, но криворукий сервис ещё и доломал: урон подрос, следующий
 * ремонт дороже. Сид от системы и текущего урона — детерминирован и меняется от попытки
 * к попытке (провал двигает урон), `Math.random` под запретом ради сети.
 */
export function repair(world: World, ship: ShipEntity): RepairOutcome {
  const dmg = hullDamage(ship)
  if (dmg <= 0) return 'nothing'
  const quote = repairQuote(world, ship)
  if (quote.chance <= 0) return 'refused'
  if (world.credits < quote.price) return 'no-money'

  const rng = makeRng(
    world.galaxySeed ^
      Math.imul(world.systemIndex + 1, 0x9e3779b1) ^
      Math.imul(Math.round(dmg), 0x85ebca6b) ^
      Math.imul(quote.itemClass, 0x27d4eb2f),
  )
  if (rng() < quote.chance) {
    world.credits -= quote.price
    ship.hull = ship.spec.hull.hull
    return 'repaired'
  }
  // Провал: не починили и подпортили. Корпус не роняем в ноль — ремонт не убивает.
  ship.hull = Math.max(1, ship.hull - ship.spec.hull.hull * SHOP.REPAIR_BOTCH_DAMAGE)
  return 'botched'
}

/** Базовая цена починки поломки, без скидки тира: доля цены детали × доля поломки. */
// ─── Ремонт ПОЛОМКИ детали ─────────────────────────────────────────────────────
//
// Отдельно от корпуса: ломается КОНКРЕТНАЯ деталь (лазер, щит, двигатель), и чинят её
// же — тем же мастером и тем же броском, что и корпус, но по классу самой детали.

export function moduleRepairCost(module: ShipModule): number {
  return Math.ceil(module.cost * moduleFault(module) * SHOP.MODULE_REPAIR_FRACTION)
}

/** Расклад ремонта ДЕТАЛИ: кто чинит, с каким шансом и почём при успехе — по классу детали. */
export function repairModuleQuote(world: World, module: ShipModule): RepairQuote {
  const settlement = localSettlement(world)
  const master = masterClass(settlement)
  const chance = repairChance(master, module.class, masterDev(settlement, master))
  const price = Math.ceil(moduleRepairCost(module) * SHOP.REPAIR_TIER_PRICE[master])
  return { master, itemClass: module.class, chance, price }
}

/**
 * Починить ПОЛОМКУ детали броском (см. `repairModuleQuote`). Успех — деталь в норму,
 * деньги списаны. Провал — денег НЕ берут, но криворукий мастер доломал: поломка
 * растёт «как за выстрел», следующий ремонт дороже. Сид от системы, класса и текущей
 * поломки — детерминирован и МЕНЯЕТСЯ от попытки к попытке (провал двигает поломку).
 */
export function repairModule(world: World, ship: ShipEntity, module: ShipModule): RepairOutcome {
  const fault = moduleFault(module)
  if (fault <= 0) return 'nothing'
  const quote = repairModuleQuote(world, module)
  if (quote.chance <= 0) return 'refused'
  if (world.credits < quote.price) return 'no-money'

  const rng = makeRng(
    world.galaxySeed ^
      Math.imul(world.systemIndex + 1, 0x9e3779b1) ^
      Math.imul(Math.round(fault * 100), 0x85ebca6b) ^
      Math.imul(hashModuleId(module.id), 0x27d4eb2f),
  )
  if (rng() < quote.chance) {
    world.credits -= quote.price
    replaceInstalled(ship, module, withFault(module, -fault)) // в ноль: деталь как новая
    refreshSpec(ship)
    return 'repaired'
  }
  // Провал: доломали. Характеристика просела ещё — пересобираем spec.
  replaceInstalled(ship, module, withFault(module, SHOP.MODULE_REPAIR_BOTCH_FAULT))
  refreshSpec(ship)
  return 'botched'
}
