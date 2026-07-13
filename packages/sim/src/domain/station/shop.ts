import { MIELOPHONE } from '../../config/mielophone'
import { SERVICE, SHOP, STOCK } from '../../config/station'
import { clamp, makeRng } from '../../core/math'
import { addCommodity, addItem, cargoMass, freeCapacity, removeItem } from '../cargo/hold'
import { COMMODITIES, itemValue, type CargoItem, type Commodity } from '../cargo/items'
import { settlementAt } from '../galaxy/generate'
import type { Settlement } from '../galaxy/types'
import { MODULE_CATALOGUE, findModule } from '../../config/modules'
import {
  deriveShipSpec,
  isArmour,
  isAux,
  isCargo,
  isCloak,
  isDrone,
  isEngine,
  isEssential,
  isHyperdrive,
  isLaser,
  isMissile,
  isShield,
  isThrusters,
  isWeapon,
  slotCategoryOf,
  type Loadout,
  type ShipModule,
  type ShipSpec,
  type WeaponModule,
} from '../loadout'
import type { ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'
import { stockLevel, unitBuyPrice, unitSellPrice } from './market'

/**
 * Торговля и ремонт. Чистые правила: ни одного обращения к UI.
 *
 * Ремонтируем только корпус. Щит восстанавливается сам — брать за это деньги
 * значило бы продавать время.
 */

export function hullDamage(ship: ShipEntity): number {
  return Math.max(0, ship.spec.hull.hull - ship.hull)
}

/** Базовая цена ремонта корпуса, без скидки мастерской. Растёт с уроном. */
export function repairCost(ship: ShipEntity): number {
  return Math.ceil(hullDamage(ship) * SHOP.HULL_REPAIR_COST)
}

// ─── Мастерская: класс по развитию планеты × класс чинимой вещи ───────────────
//
// Отменяет прежнее жёсткое «чинят только по своему уровню». Теперь мастер БЕРЁТСЯ за
// работу вероятностно: класс-1 (захолустье) уверенно чинит класс-1, но за класс-2 —
// как повезёт, а класс-3 «не видел и не умеет». Развитее мастер — выше шанс и шире охват.
// Провал корпус не чинит, а порой доламывает (урон растёт), но денег за провал не берут.

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
function masterDev(settlement: Settlement, m: MasterClass): number {
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

export function priceOf(module: ShipModule): number {
  return Math.ceil(module.cost * SHOP.MARKUP)
}

export function resaleOf(module: ShipModule): number {
  return Math.floor(module.cost * SHOP.RESALE)
}

export type PurchaseError = 'no-money' | 'wrong-kind' | 'class-too-large' | 'no-hardpoint' | 'already-installed'

/** Слоты корпуса под КАТЕГОРИЮ этого модуля. Класс гейтит корпус (`chassis.class`), не слот. */
function fittingSlots(ship: ShipEntity, module: ShipModule): number {
  if (module.class > ship.loadout.chassis.class) return 0 // не по классу корпуса — некуда
  const cat = slotCategoryOf(module.kind)
  return ship.loadout.chassis.slots.filter((s) => s.kind === cat).length
}

function installedOfKind(ship: ShipEntity, kind: ShipModule['kind']): ShipModule[] {
  return ship.loadout.internals.filter((m) => m.kind === kind)
}

/** Установленные модули той же КАТЕГОРИИ (аукс-виды считаются вместе). */
function installedOfCategory(ship: ShipEntity, module: ShipModule): ShipModule[] {
  const cat = slotCategoryOf(module.kind)
  return ship.loadout.internals.filter((m) => slotCategoryOf(m.kind) === cat)
}

/**
 * Проверка покупки БЕЗ побочных эффектов. UI зовёт её, чтобы погасить кнопку;
 * `buy` зовёт её же, чтобы не разойтись с UI в оценке.
 *
 * «Слот занят» — не ошибка. Апгрейд по определению вытесняет то, что стоит:
 * иначе улучшить щит на корабле с одним щитовым слотом было бы нельзя вообще,
 * и вся ветка прокачки оказалась бы мёртвой.
 */
export function canBuy(
  world: World,
  ship: ShipEntity,
  module: ShipModule,
  hardpointIndex?: number,
): PurchaseError | null {
  if (world.credits < priceOf(module)) return 'no-money'

  if (isWeapon(module)) {
    if (hardpointIndex === undefined) return 'no-hardpoint'
    const hardpoint = ship.loadout.chassis.hardpoints[hardpointIndex]
    if (!hardpoint) return 'no-hardpoint'

    const wanted = module.kind === 'missile' ? 'pylon' : 'gun'
    if (hardpoint.kind !== wanted) return 'wrong-kind'
    if (module.class > ship.loadout.chassis.class) return 'class-too-large'
    if (ship.loadout.weapons[hardpointIndex]?.id === module.id) return 'already-installed'
    return null
  }

  const slots = fittingSlots(ship, module)
  if (slots === 0) {
    // Слота такой категории нет вовсе — или он есть, но модуль не по классу корпуса.
    const cat = slotCategoryOf(module.kind)
    const anyKind = ship.loadout.chassis.slots.some((s) => s.kind === cat)
    return anyKind ? 'class-too-large' : 'wrong-kind'
  }

  const installed = installedOfKind(ship, module.kind)
  // Ставить второй такой же незачем: он ничего не добавит, а деньги спишет.
  if (installed.length >= slots && installed.every((m) => m.id === module.id)) return 'already-installed'
  return null
}

/**
 * Купить и поставить. Вытесненный модуль станция забирает по остаточной цене —
 * иначе апгрейд превращается в выбрасывание исправного железа.
 */
export function buy(
  world: World,
  ship: ShipEntity,
  module: ShipModule,
  hardpointIndex?: number,
): PurchaseError | null {
  const error = canBuy(world, ship, module, hardpointIndex)
  if (error) return error

  // Прирост брони даёт прочность СРАЗУ: новая плита цела, а не «требует ремонта».
  const maxHullBefore = ship.spec.hull.hull
  world.credits -= priceOf(module)

  if (isWeapon(module) && hardpointIndex !== undefined) {
    const previous = ship.loadout.weapons[hardpointIndex]
    if (previous) world.credits += resaleOf(previous)
    ship.loadout.weapons[hardpointIndex] = module
  } else {
    const installed = installedOfKind(ship, module.kind)
    if (installed.length >= fittingSlots(ship, module)) {
      // Свободных слотов нет — вытесняем самый дешёвый: он и есть худший.
      const worst = installed.reduce((a, b) => (a.cost <= b.cost ? a : b))
      ship.loadout.internals.splice(ship.loadout.internals.indexOf(worst), 1)
      world.credits += resaleOf(worst)
    }
    ship.loadout.internals.push(module)
  }

  // Масса изменилась — значит изменились и ускорения. Пересобираем на СОБЫТИЕ.
  refreshSpec(ship)
  grantArmourHull(ship, maxHullBefore)
  return null
}

/** Прирост максимума корпуса (от новой брони) даём текущему корпусу — плита цела сразу. */
function grantArmourHull(ship: ShipEntity, maxHullBefore: number): void {
  const gained = ship.spec.hull.hull - maxHullBefore
  if (gained > 0) ship.hull = Math.min(ship.spec.hull.hull, ship.hull + gained)
}

/** Что станция может предложить из произвольного набора: бесплатный стартовый хлам не продаётся. */
export function stock(catalogue: readonly ShipModule[]): readonly ShipModule[] {
  return catalogue.filter((m) => m.cost > 0)
}

/**
 * Шанс, что модуль лежит на прилавке ЭТОГО поселения, 0..1. Чистая функция от
 * (класс, тех-уровень): развитость двигает вверх, класс — вниз. Ею и решается,
 * почему у столицы витрина ломится, а у окраины — пара стволов классом пониже.
 */
export function stockChance(module: ShipModule, settlement: Settlement): number {
  const classPenalty = (module.class - 1) * STOCK.CLASS_PENALTY
  const techBonus = (settlement.techLevel - STOCK.REF_TECH) * STOCK.TECH_BONUS
  return clamp(STOCK.BASE_CHANCE - classPenalty + techBonus, STOCK.MIN_CHANCE, STOCK.MAX_CHANCE)
}

/**
 * Ассортимент станции этой системы. Детерминирован из зерна и индекса системы,
 * как и цены: два пилота в одной системе видят одну витрину, ничего не пересылая.
 * Оттого магазин синхронизируется по сети даром. Решение по каждому модулю —
 * независимый бросок от собственного зерна, поэтому список стабилен между вызовами.
 */
/** Минимальный тех-уровень мира, чтобы держать/обслуживать модуль этого КЛАССА. */
export function minTechForClass(cls: 1 | 2 | 3 | 4): number {
  return SERVICE.MIN_TECH_BY_CLASS[cls]
}

/**
 * Тянет ли ЭТОТ мир такой класс железа — и продать, и обслужить. Развитость поселения
 * это технологический потолок: класс 4 (вершина, сюда же ремонт инструментов бога)
 * доступен лишь на тех ≥ 12, а дикарям не собрать и класс 2. Одна дверь для витрины и
 * для сервиса, чтобы «где куплю» и «где починю» отвечали одинаково.
 */
export function canServiceHere(world: World, module: ShipModule): boolean {
  return localSettlement(world).techLevel >= minTechForClass(module.class)
}

export function stationStock(world: World): readonly ShipModule[] {
  const settlement = localSettlement(world)
  return MODULE_CATALOGUE.filter((m) => {
    if (m.cost <= 0) return false // бесплатный стартовый хлам не продают
    // Тех-потолок мира: высокий класс на отсталой планете не сделать — его там и не продают.
    if (settlement.techLevel < minTechForClass(m.class)) return false
    const rng = makeRng(world.galaxySeed ^ Math.imul(world.systemIndex + 1, 0x9e3779b1) ^ hashModuleId(m.id))
    return rng() < stockChance(m, settlement)
  })
}

function hashModuleId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

// ─── Перестановка железа: установить из трюма, сравнить с установленным ────────

export type FitError = 'not-a-module' | 'wrong-kind' | 'class-too-large' | 'no-hardpoint' | 'already-installed' | 'no-room'

/** Слоты корпуса под КАТЕГОРИЮ модуля — без корабля, от одного шасси. Класс гейтит корпус. */
function slotsForChassis(loadout: Loadout, module: ShipModule): number {
  if (module.class > loadout.chassis.class) return 0
  const cat = slotCategoryOf(module.kind)
  return loadout.chassis.slots.filter((s) => s.kind === cat).length
}

/** Первая подходящая точка подвески: пустая предпочтительнее занятой. */
function autoHardpoint(ship: ShipEntity, module: ShipModule): number | undefined {
  const wanted = module.kind === 'missile' ? 'pylon' : 'gun'
  const points = ship.loadout.chassis.hardpoints
  let firstFit: number | undefined
  for (let i = 0; i < points.length; i++) {
    const h = points[i]!
    if (h.kind !== wanted || module.class > ship.loadout.chassis.class) continue
    if (!ship.loadout.weapons[i]) return i
    if (firstFit === undefined) firstFit = i
  }
  return firstFit
}

/** Какой модуль вытеснит установка: снимаемое оружие или самый дешёвый из того же вида. */
function moduleToReplace(ship: ShipEntity, module: ShipModule, hardpointIndex?: number): ShipModule | null {
  if (isWeapon(module)) return hardpointIndex !== undefined ? ship.loadout.weapons[hardpointIndex] ?? null : null
  // Категория полна — вытесняем самый дешёвый той же категории (аукс-виды считаются вместе).
  const installed = installedOfCategory(ship, module)
  return installed.length >= fittingSlots(ship, module) ? installed.reduce((a, b) => (a.cost <= b.cost ? a : b)) : null
}

/** Влезет ли модуль на корабль (без денег: он уже твой). Гасит кнопку и страхует `fitFromHold`. */
export function canFit(ship: ShipEntity, module: ShipModule, hardpointIndex?: number): FitError | null {
  if (isWeapon(module)) {
    if (hardpointIndex === undefined) return 'no-hardpoint'
    const hp = ship.loadout.chassis.hardpoints[hardpointIndex]
    if (!hp) return 'no-hardpoint'
    const wanted = module.kind === 'missile' ? 'pylon' : 'gun'
    if (hp.kind !== wanted) return 'wrong-kind'
    if (module.class > ship.loadout.chassis.class) return 'class-too-large'
    if (ship.loadout.weapons[hardpointIndex]?.id === module.id) return 'already-installed'
    return null
  }
  const slots = fittingSlots(ship, module)
  if (slots === 0) {
    const cat = slotCategoryOf(module.kind)
    const anyKind = ship.loadout.chassis.slots.some((s) => s.kind === cat)
    return anyKind ? 'class-too-large' : 'wrong-kind'
  }
  const installed = installedOfKind(ship, module.kind)
  if (installed.length >= slots && installed.every((m) => m.id === module.id)) return 'already-installed'
  return null
}

/**
 * Поставить модуль ИЗ ТРЮМА. Денег не берёт — железо уже твоё, подобранное с
 * обломков или снятое ранее. Вытесненное уходит НЕ на продажу, а обратно в трюм:
 * это перестановка своего добра, а не апгрейд за деньги (тем занят `buy`).
 *
 * Только на верфи: менять оснастку в пути немыслимо, и это правило держит UI —
 * домен же просто исполняет операцию, когда его позвали.
 */
export function fitFromHold(ship: ShipEntity, holdIndex: number): FitError | null {
  const item = ship.hold.items[holdIndex]
  if (!item || item.kind !== 'module') return 'not-a-module'
  const module = item.module

  const slot = isWeapon(module) ? autoHardpoint(ship, module) : undefined
  const error = canFit(ship, module, slot)
  if (error) return error

  const displaced = moduleToReplace(ship, module, slot)
  // Снятое поедет в трюм. Входящий модуль его освобождает, поэтому место считаем с запасом.
  if (displaced && freeCapacity(ship.hold) + module.mass < displaced.mass) return 'no-room'

  const maxHullBefore = ship.spec.hull.hull // прирост брони дадим корпусу сразу
  removeItem(ship.hold, holdIndex)
  if (isWeapon(module) && slot !== undefined) {
    ship.loadout.weapons[slot] = module
  } else {
    if (displaced) ship.loadout.internals.splice(ship.loadout.internals.indexOf(displaced), 1)
    ship.loadout.internals.push(module)
  }
  if (displaced) addItem(ship.hold, { kind: 'module', module: displaced })

  // Масса и характеристики сменились — пересобираем на СОБЫТИЕ.
  refreshSpec(ship)
  grantArmourHull(ship, maxHullBefore)
  return null
}

/**
 * Идентификатор характеристики — НЕ слово. Домен языка не знает: перевод «щита» в
 * «ЩИТ»/«SHLD» и подстановку единиц делает слой интерфейса. Иначе перевод пришлось
 * бы тащить в симуляцию, которой стоять на сервере без всякого экрана.
 */
export type StatKey =
  | 'shield' | 'hull' | 'speed' | 'turn' | 'cargo' | 'jump'
  | 'thrust' | 'damage' | 'ammo' | 'drain' | 'scale' | 'mass'

/** Одна строка сравнения: было → станет по конкретной характеристике. */
export interface StatDelta {
  key: StatKey
  from: number
  to: number
  /** Рост — это хорошо? У расхода и массы было бы наоборот; пока все растущие. */
  higherBetter: boolean
}

/** Характеристики, которые модуль может сдвинуть. Считаются из spec — без ветвления по виду. */
const SPEC_FIELDS: readonly { key: StatKey; get: (s: ShipSpec) => number }[] = [
  { key: 'shield', get: (s) => s.hull.shield },
  { key: 'hull', get: (s) => s.hull.hull },
  { key: 'speed', get: (s) => s.tuning.MAX_SPEED },
  { key: 'turn', get: (s) => s.tuning.PITCH_ACCEL },
  { key: 'cargo', get: (s) => s.cargoCapacity },
  { key: 'jump', get: (s) => s.jumpRange },
]

/** Тот же loadout, но с установленным модулем: гипотетический, для сравнения spec. */
function withFitted(loadout: Loadout, module: ShipModule): Loadout {
  const internals = [...loadout.internals]
  const installed = internals.filter((m) => m.kind === module.kind)
  if (installed.length >= slotsForChassis(loadout, module)) {
    const worst = installed.reduce((a, b) => (a.cost <= b.cost ? a : b))
    internals.splice(internals.indexOf(worst), 1)
  }
  internals.push(module)
  return { ...loadout, internals }
}

/**
 * Что изменится, если поставить этот модуль ВМЕСТО стоящего. Сразу видно, плюс он
 * или минус: сравниваются посчитанные характеристики, а не обещания каталога.
 * Для внутренних — разница spec (щит, разворот, трюм…), для оружия — урон.
 * Возвращает КЛЮЧИ характеристик; слова к ним подберёт интерфейс.
 */
export function fitDeltas(ship: ShipEntity, module: ShipModule): StatDelta[] {
  if (isWeapon(module)) {
    const slot = autoHardpoint(ship, module)
    const prev = slot !== undefined ? ship.loadout.weapons[slot] : null
    const from = prev && 'damage' in prev ? prev.damage : 0
    const to = 'damage' in module ? module.damage : 0
    return from === to ? [] : [{ key: 'damage', from, to, higherBetter: true }]
  }

  const after = deriveShipSpec(withFitted(ship.loadout, module), cargoMass(ship.hold))
  const out: StatDelta[] = []
  for (const f of SPEC_FIELDS) {
    const from = f.get(ship.spec)
    const to = f.get(after)
    if (Math.abs(to - from) > 1e-3) out.push({ key: f.key, from, to, higherBetter: true })
  }
  return out
}

/**
 * Заголовочная характеристика модуля — «какой плюс он даёт» для списков: КЛЮЧ и
 * число. Слово и единицу подставит интерфейс, поэтому здесь ни того, ни другого.
 */
/**
 * Больше — это лучше? Для почти всех характеристик да, но не для всех: у расхода
 * маскировки (и вообще у «затрат») меньшее число — выигрыш. UI обязан красить
 * стрелку по СМЫСЛУ, а не по величине: «такой же, но цифра меньше» иногда и есть
 * тот, что круче. Домен знает смысл каждой оси — пусть интерфейс не гадает.
 */
export function statHigherBetter(key: StatKey): boolean {
  // У расхода и массы меньшее число — выигрыш.
  return key !== 'drain' && key !== 'mass'
}

export function moduleStat(m: ShipModule): { key: StatKey; value: number } {
  switch (m.kind) {
    case 'engine': return { key: 'thrust', value: m.thrust }
    case 'thrusters': return { key: 'turn', value: m.maxRate[2] }
    case 'shield': return { key: 'shield', value: m.capacity }
    case 'armour': return { key: 'hull', value: m.hull }
    case 'laser': return { key: 'damage', value: m.damage }
    case 'missile': return { key: 'ammo', value: m.ammo }
    case 'drone': return { key: 'ammo', value: m.ammo }
    case 'cargo': return { key: 'cargo', value: m.capacity }
    case 'hyperdrive': return { key: 'jump', value: m.jumpRange }
    case 'cloak': return { key: 'drain', value: m.drain }
    // Миелофон: своей числовой характеристики нет (темп и пределы в config/mielophone).
    // Показываем темп роста — единственное осмысленное число артефакта.
    case 'mielophone': return { key: 'scale', value: MIELOPHONE.GROW_RATE }
    // Аукс-устройства (ECM/бомба/скуп) числовой характеристики не имеют — показываем
    // массу как честный скаляр (меньше — лучше). Параметры срабатывания живут в config.
    case 'ecm':
    case 'bomb':
    case 'scoop': return { key: 'mass', value: m.mass }
  }
}

// ─── Прокачка модуля ──────────────────────────────────────────────────────────

export type UpgradeError = 'maxed' | 'no-copy' | 'no-money' | 'low-tech'

/** Накопленная прибавка модуля, доля к стоку: 0 — заводской, 0.5 — «+50%». */
export function upgradeLevel(module: ShipModule): number {
  return module.upgrade ?? 0
}

/**
 * Индекс копии этого модуля в трюме — по тому же `id` (прокачка id не меняет).
 * Ею и качают на +50%: копия честнее денег, оттого и сильнее. null — копии нет.
 */
export function upgradeCopyIndex(ship: ShipEntity, module: ShipModule): number | null {
  const i = ship.hold.items.findIndex((it) => it.kind === 'module' && it.module.id === module.id)
  return i >= 0 ? i : null
}

/** Цена ОДНОГО денежного шага прокачки. С копией денег не берут — платит трюм. */
export function upgradeCashCost(module: ShipModule): number {
  return Math.ceil(Math.max(module.cost, SHOP.UPGRADE_MIN_BASE) * SHOP.UPGRADE_CASH_FRACTION)
}

/** Проверка БЕЗ побочных эффектов: ею UI гасит кнопку, ею же `upgradeModule` решает. */
export function canUpgrade(
  world: World,
  ship: ShipEntity,
  module: ShipModule,
  useCopy: boolean,
): UpgradeError | null {
  // Аукс-устройства не прокачиваются: каждое работает по-своему, «+25% к ECM» бессмыслен.
  // Гасим как «предельный» — отдельного кода в UI заводить незачем.
  if (isAux(module)) return 'maxed'
  // Каждый модуль улучшается один раз: уже прокачанный дальше не берут.
  if (upgradeLevel(module) > 1e-6) return 'maxed'
  // Мир не тянет этот класс — прокачать его здесь негде (тот же потолок, что и у витрины).
  if (!canServiceHere(world, module)) return 'low-tech'
  if (useCopy) return upgradeCopyIndex(ship, module) === null ? 'no-copy' : null
  return world.credits < upgradeCashCost(module) ? 'no-money' : null
}

/**
 * Множит характеристики модуля от СТОКА: clone.field = base.field × (1+level).
 * От стока, а не от текущего значения, — чтобы показанное «+50%» точно равнялось
 * правде, а не накопленной дроби с округлениями. Момент и лимиты множатся целиком:
 * разворот растёт по всем осям. У маскировки растёт не расход, а экономичность —
 * потому делится, а не множится: меньше жрёт батарей значит лучше.
 */
function scaleToBase(m: ShipModule, base: ShipModule, k: number): void {
  if (isEngine(m) && isEngine(base)) { m.thrust = base.thrust * k; m.maxSpeed = base.maxSpeed * k; return }
  if (isThrusters(m) && isThrusters(base)) {
    m.torque = [base.torque[0] * k, base.torque[1] * k, base.torque[2] * k]
    m.maxRate = [base.maxRate[0] * k, base.maxRate[1] * k, base.maxRate[2] * k]
    return
  }
  if (isShield(m) && isShield(base)) { m.capacity = base.capacity * k; m.regen = base.regen * k; return }
  if (isArmour(m) && isArmour(base)) { m.hull = base.hull * k; return }
  if (isLaser(m) && isLaser(base)) { m.damage = base.damage * k; return }
  // Ракета — расходник: её не чинят, но пусковую УЛУЧШАЮТ бо́льшим боезапасом (не уроном).
  if (isMissile(m) && isMissile(base)) { m.ammo = Math.round(base.ammo * k); return }
  if (isDrone(m) && isDrone(base)) { m.ammo = Math.round(base.ammo * k); return }
  if (isCargo(m) && isCargo(base)) { m.capacity = Math.round(base.capacity * k); return }
  if (isHyperdrive(m) && isHyperdrive(base)) { m.jumpRange = base.jumpRange * k; return }
  if (isCloak(m) && isCloak(base)) { m.drain = base.drain / k }
}

/** Собственный прокачанный экземпляр модуля. Конфиг не трогаем — он общий на всех. */
function withUpgrade(module: ShipModule, level: number): ShipModule {
  const base = findModule(module.id) ?? module
  const clone: ShipModule = { ...module, upgrade: level }
  scaleToBase(clone, base, 1 + level)
  return clone
}

/**
 * Значение главной характеристики ПОСЛЕ прокачки (копией +50% / деньгами +25%) — для
 * предпросмотра «было → станет» в верфи. Считает ровно тем путём, что и сама прокачка,
 * поэтому число в окне не разойдётся с делом.
 */
export function upgradedStatValue(module: ShipModule, useCopy: boolean): number {
  const level = useCopy ? SHOP.UPGRADE_COPY_STEP : SHOP.UPGRADE_CASH_STEP
  return moduleStat(withUpgrade(module, level)).value
}

/**
 * Прокачать установленный модуль. Клон заменяет ИМЕННО тот экземпляр, что стоит в
 * оснастке (сверяем по ссылке — UI передаёт реальный модуль из loadout). Копия из
 * трюма расходуется; денежная дорога — списывает кредиты. Массу не трогаем: усиление
 * характеристики не должно тайком менять манёвренность, только заявленную ось.
 *
 * Только на верфи — как и вся смена оснастки: правило держит UI, домен исполняет.
 */
export function upgradeModule(
  world: World,
  ship: ShipEntity,
  module: ShipModule,
  useCopy: boolean,
): UpgradeError | null {
  const error = canUpgrade(world, ship, module, useCopy)
  if (error) return error

  // Однократно: до сюда доходит только сток (canUpgrade отсекает уже прокачанный).
  const level = useCopy ? SHOP.UPGRADE_COPY_STEP : SHOP.UPGRADE_CASH_STEP
  const upgraded = withUpgrade(module, level)

  const wi = ship.loadout.weapons.findIndex((w) => w === module)
  if (wi >= 0) {
    ship.loadout.weapons[wi] = upgraded as WeaponModule
  } else {
    const ii = ship.loadout.internals.indexOf(module)
    if (ii < 0) return 'no-copy' // модуля нет на корабле — звать было неоткуда
    ship.loadout.internals[ii] = upgraded
  }

  if (useCopy) {
    const idx = upgradeCopyIndex(ship, module) // копия ещё в трюме — она и оплата
    if (idx !== null) removeItem(ship.hold, idx)
  } else {
    world.credits -= upgradeCashCost(module)
  }

  // Характеристики сменились — пересобираем на СОБЫТИЕ, как и при покупке.
  refreshSpec(ship)
  return null
}

// ─── Снятие и продажа установленного модуля ───────────────────────────────────

export type StripError = 'not-installed' | 'no-room' | 'essential'

/** Где стоит модуль: точка подвески, внутренний слот, или нигде (уже снят). */
function locateInstalled(ship: ShipEntity, module: ShipModule): { weapon: number } | { internal: number } | null {
  const wi = ship.loadout.weapons.findIndex((w) => w === module)
  if (wi >= 0) return { weapon: wi }
  const ii = ship.loadout.internals.indexOf(module)
  if (ii >= 0) return { internal: ii }
  return null
}

function detach(ship: ShipEntity, at: { weapon: number } | { internal: number }): void {
  if ('weapon' in at) ship.loadout.weapons[at.weapon] = null
  else ship.loadout.internals.splice(at.internal, 1)
}

/**
 * Снять установленный модуль В ТРЮМ — своё железо, назад бесплатно. Не влезет в трюм
 * (тяжелее свободного места) — операция не идёт. Точка подвески становится пустой,
 * внутренний просто уходит из списка. Только на верфи: правило держит UI.
 */
export function unfitModule(ship: ShipEntity, module: ShipModule): StripError | null {
  const at = locateInstalled(ship, module)
  if (!at) return 'not-installed'
  // Двигатель и маневровые в пустоту не снимают — без них корабль не сдвинется.
  // Заменить другим того же вида можно (см. fitFromHold/buy), остаться без — нет.
  if (isEssential(module)) return 'essential'
  if (freeCapacity(ship.hold) < module.mass) return 'no-room'
  detach(ship, at)
  addItem(ship.hold, { kind: 'module', module })
  refreshSpec(ship)
  return null
}

/**
 * Выкупная цена установленного модуля. Сток × RESALE, поднятая ПРОКАЧКОЙ (+50%/+25%
 * дороже — за неё платили) и сбитая ПОВРЕЖДЕНИЕМ: у брони по недостающему корпусу,
 * ведь чинят именно его. Продают дешевле, чем покупают, — спред и есть плата за то,
 * что сбыть железо можно тут же, не ища покупателя.
 */
export function moduleResaleValue(ship: ShipEntity, module: ShipModule): number {
  let value = module.cost * SHOP.RESALE * (1 + upgradeLevel(module))
  if (isArmour(module) && ship.spec.hull.hull > 0) {
    value *= 1 - hullDamage(ship) / ship.spec.hull.hull
  }
  return Math.max(0, Math.floor(value))
}

/**
 * Продать установленный модуль: снять и получить кредиты по выкупной цене. В трюм
 * не кладём — сразу в деньги, поэтому места он не требует (в отличие от «снять»).
 */
export function sellModule(world: World, ship: ShipEntity, module: ShipModule): StripError | null {
  const at = locateInstalled(ship, module)
  if (!at) return 'not-installed'
  // Продать — это снять: последний двигатель или маневровые продавать нельзя, иначе
  // корабль останется недвижимым прямо на верфи. Только замена (см. buy) их сбывает.
  if (isEssential(module)) return 'essential'
  const value = moduleResaleValue(ship, module)
  detach(ship, at)
  world.credits += value
  refreshSpec(ship)
  return null
}

// ─── Груз ────────────────────────────────────────────────────────────────────

/**
 * Поселение-столица, чьей станцией сейчас торгует пилот. Выводится из зерна
 * системы (см. `settlementAt`) — не хранится в мире и оттого одинаково у всех,
 * кто зашёл в ту же систему. На нём и держится будущая сетевая синхронизация цен.
 */
const NEUTRAL_MARKET: Settlement = {
  economy: 'Промышленная', government: 'Многовластие', techLevel: 7, population: 1, species: '—',
}

export function localSettlement(world: World): Settlement {
  return settlementAt(world.systemIndex, world.galaxySeed) ?? NEUTRAL_MARKET
}

/** Номинальная стоимость трюма по каталогу — грубая прикидка, без учёта рынка. */
export function cargoValue(ship: ShipEntity): number {
  let total = 0
  for (const item of ship.hold.items) total += itemValue(item)
  return total
}

/** Прилавок станции. Пока весь каталог: цену и наличие каждого решает рынок. */
export function commodityStock(): readonly Commodity[] {
  return Object.values(COMMODITIES)
}

/** Цена покупки единицы здесь. Выше цены продажи на спред — прилавок не благотворитель. */
export function commodityBuyPrice(world: World, commodity: Commodity): number {
  return unitBuyPrice(commodity, localSettlement(world), world.systemIndex, world.galaxySeed)
}

/** Цена, по которой станция ПРИНИМАЕТ единицу. Ниже покупки — отсюда и убыток на месте. */
export function commoditySellPrice(world: World, commodity: Commodity): number {
  return unitSellPrice(commodity, localSettlement(world), world.systemIndex, world.galaxySeed)
}

/** Сколько единиц товара на складе станции. Мало — цена выше, много — ниже. */
export function commodityStockAt(world: World, commodity: Commodity): number {
  return stockLevel(commodity, localSettlement(world), world.systemIndex, world.galaxySeed)
}

/** Выручка за один предмет трюма здесь. Товар — по рынку, модуль — по остаточной цене. */
export function itemSellValue(world: World, item: CargoItem): number {
  if (item.kind === 'commodity') return commoditySellPrice(world, item.commodity) * item.units
  return itemValue(item)
}

/** Сколько выручит весь трюм, если продать его на ЭТОЙ станции. */
export function holdSellValue(world: World, ship: ShipEntity): number {
  let total = 0
  for (const item of ship.hold.items) total += itemSellValue(world, item)
  return total
}

export type TradeError = 'no-money' | 'no-room'

/**
 * Проверка покупки БЕЗ побочных эффектов — ею UI гасит кнопку, ею же `buyCommodity`
 * решает, продавать ли. Две независимые проверки однажды разошлись бы.
 */
export function canBuyCommodity(world: World, ship: ShipEntity, commodity: Commodity): TradeError | null {
  if (world.credits < commodityBuyPrice(world, commodity)) return 'no-money'
  if (freeCapacity(ship.hold) < commodity.unitMass) return 'no-room'
  return null
}

/**
 * Купить сколько-то единиц товара. Берём столько, сколько влезает И на сколько
 * хватает денег: отказать целиком там, где можно продать половину, — плохая лавка.
 *
 * Уплаченное записываем в стопку (`costBasis`): без цены входа не показать выгоду
 * на продаже. Это личная история пилота, а не свойство рынка.
 *
 * @returns купленное количество, ноль — если не вышло ничего.
 */
export function buyCommodity(world: World, ship: ShipEntity, commodity: Commodity, units: number): number {
  const price = commodityBuyPrice(world, commodity)
  if (price <= 0 || units <= 0) return 0

  const affordable = Math.floor(world.credits / price)
  const fits = Math.floor(freeCapacity(ship.hold) / commodity.unitMass)
  const taken = Math.min(units, affordable, fits)
  if (taken <= 0) return 0

  const added = addCommodity(ship.hold, commodity, taken)
  if (added <= 0) return 0

  const stack = ship.hold.items.find(
    (i): i is Extract<CargoItem, { kind: 'commodity' }> =>
      i.kind === 'commodity' && i.commodity.id === commodity.id,
  )
  if (stack) stack.costBasis = (stack.costBasis ?? 0) + added * price

  world.credits -= added * price
  // Тонны в трюме меняют ускорения. Это считается, а не назначается.
  refreshSpec(ship)
  return added
}

/**
 * Продать один предмет из трюма — по индексу, а не «всё разом»: контрабанду
 * иногда выгоднее держать, а лом сбыть.
 *
 * @returns выручка, ноль — если индекса нет.
 */
export function sellItem(world: World, ship: ShipEntity, index: number): number {
  const item = ship.hold.items[index]
  if (!item) return 0

  const value = itemSellValue(world, item)
  removeItem(ship.hold, index)
  world.credits += value
  refreshSpec(ship)
  return value
}

/**
 * Продать весь трюм разом. Возвращает выручку; ноль, если продавать нечего.
 *
 * Пересобираем характеристики: пустой трюм — это минус тонны, то есть плюс
 * к ускорениям. Забыть здесь `refreshSpec` значило бы летать с массой призрака.
 */
export function sellCargo(world: World, ship: ShipEntity): number {
  const value = holdSellValue(world, ship)
  if (value === 0) return 0

  world.credits += value
  ship.hold.items.length = 0
  refreshSpec(ship)
  return value
}

// ─── Боезапас ────────────────────────────────────────────────────────────────

/** Сколько ракет не хватает до полного боекомплекта во всех пусковых. */
export function missingRounds(ship: ShipEntity): number {
  let missing = 0
  ship.spec.mounts.forEach((mount, i) => {
    if (!isMissile(mount.weapon)) return
    missing += Math.max(0, mount.weapon.ammo - (ship.guns[i]?.ammo ?? 0))
  })
  return missing
}

export function rearmCost(ship: ShipEntity): number {
  return missingRounds(ship) * SHOP.MISSILE_ROUND_COST
}

/**
 * Пополнить ракеты во всех пусковых. Пусковая — модуль, ракета — расходник:
 * без этой операции ракетное вооружение работало ровно один вылет.
 *
 * Бомбы здесь нет намеренно: она копится от реактора, а не покупается.
 */
export function rearm(world: World, ship: ShipEntity): boolean {
  const cost = rearmCost(ship)
  if (cost === 0 || world.credits < cost) return false

  world.credits -= cost
  ship.spec.mounts.forEach((mount, i) => {
    if (!isMissile(mount.weapon)) return
    const gun = ship.guns[i]
    if (gun) gun.ammo = mount.weapon.ammo
  })
  return true
}
