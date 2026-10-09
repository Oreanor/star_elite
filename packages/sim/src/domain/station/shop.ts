import { SHOP, STOCK } from '../../config/station'
import { clamp, makeRng } from '../../core/math'
import { addItem, cargoMass, freeCapacity, removeItem } from '../cargo/hold'
import type { Settlement } from '../galaxy/types'
import { MODULE_CATALOGUE } from '../../config/modules'
import {
  deriveShipSpec,
  isArmour,
  isDrone,
  isEssential,
  isMissile,
  isWeapon,
  slotCategoryOf,
  type Loadout,
  type ShipModule,
  type ShipSpec,
  type WeaponModule,
} from '../loadout'
import type { ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'
import { StatKey, hashModuleId, locateInstalled, minTechForClass, moduleFault, upgradeLevel, withUpgrade } from './moduleState'
import { hullDamage } from './repair'
import { localSettlement } from './trade'
import { UpgradeError, canUpgrade, upgradeCashCost, upgradeCopyIndex } from './upgrade'

/**
 * Торговля и ремонт. Чистые правила: ни одного обращения к UI.
 *
 * Ремонтируем только корпус. Щит восстанавливается сам — брать за это деньги
 * значило бы продавать время.
 */

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

// ─── Ракетный (мунишн) слот: ОДИН тип на всю подвеску ─────────────────────────
//
// Ракеты — ОДНА ячейка на все пилоны: один тип, боезапас общий. Дрон-ракеты — ПРОСТО
// ДРУГОЙ ТИП ракет (контейнер БПЛА вместо боеголовки): их покупают и ставят в тот же слот
// ВЗАМЕН обычных. Оттого «мунишн» = ракета ИЛИ дрон, но на всех пилонах один и тот же.
// Домен хранит их по пилонам (точки пуска для боя и рендера), но операции — по слоту ЦЕЛИКОМ.

/** Ракета или дрон-контейнер — оба сходят с пилона и делят один мунишн-слот. */
function isMunition(m: ShipModule): boolean {
  return isMissile(m) || isDrone(m)
}

/** Индексы ВСЕХ ракетных пилонов корпуса (точки подвески 'pylon'). */
export function missilePylonIndices(ship: ShipEntity): number[] {
  const out: number[] = []
  ship.loadout.chassis.hardpoints.forEach((hp, i) => {
    if (hp.kind === 'pylon') out.push(i)
  })
  return out
}

/** Мунишн, стоящий в слоте сейчас (ракета или дрон, тип один на всех). null — слот пуст. */
export function installedMissile(ship: ShipEntity): ShipModule | null {
  for (const i of missilePylonIndices(ship)) {
    const w = ship.loadout.weapons[i]
    if (w && isMunition(w)) return w
  }
  return null
}

/** Тот же тип уже на ВСЕХ пилонах — слот полностью снаряжён им. */
function missilesAllOfType(ship: ShipEntity, id: string): boolean {
  const pylons = missilePylonIndices(ship)
  return pylons.length > 0 && pylons.every((i) => ship.loadout.weapons[i]?.id === id)
}

/**
 * Снарядить слот КУПЛЕННЫМ типом (ракеты или дрон-ракеты): один тип на все пилоны, плата —
 * как за один комплект (слот один). Прежний тип (если стоял другой) уходит станции по
 * остаточной цене ОДИН раз — комплект, а не по пилону.
 */
export function armMissiles(world: World, ship: ShipEntity, module: ShipModule): PurchaseError | null {
  if (!isMunition(module)) return 'wrong-kind'
  if (module.class > ship.loadout.chassis.class) return 'class-too-large'
  const pylons = missilePylonIndices(ship)
  if (pylons.length === 0) return 'no-hardpoint'
  if (missilesAllOfType(ship, module.id)) return 'already-installed'
  if (world.credits < priceOf(module)) return 'no-money'

  const prev = installedMissile(ship) // прежний тип (инвариант: один на всех)
  world.credits -= priceOf(module)
  if (prev) world.credits += resaleOf(prev) // один комплект — одна выручка
  for (const i of pylons) ship.loadout.weapons[i] = module as WeaponModule
  refreshSpec(ship)
  return null
}

/** Снарядить слот типом ИЗ ТРЮМА (даром — своё). Прежний тип возвращается в трюм. */
export function armMissilesFromHold(ship: ShipEntity, holdIndex: number): FitError | null {
  const item = ship.hold.items[holdIndex]
  if (!item || item.kind !== 'module') return 'not-a-module'
  const module = item.module
  if (!isMunition(module)) return 'wrong-kind'
  if (module.class > ship.loadout.chassis.class) return 'class-too-large'
  const pylons = missilePylonIndices(ship)
  if (pylons.length === 0) return 'no-hardpoint'
  if (missilesAllOfType(ship, module.id)) return 'already-installed'

  const prev = installedMissile(ship)
  removeItem(ship.hold, holdIndex) // входящий уходит из трюма — освобождает место под прежний
  if (prev) addItem(ship.hold, { kind: 'module', module: prev })
  for (const i of pylons) ship.loadout.weapons[i] = module as WeaponModule
  refreshSpec(ship)
  return null
}

/**
 * Прокачать слот ЦЕЛИКОМ: усиленный тип встаёт на ВСЕ пилоны разом, иначе прокачался бы
 * один пилон, а прочие остались стоком — боезапас слота вырос бы лишь на треть. Копия/деньги —
 * как в `upgradeModule`, но по слоту, а не по одному стволу.
 */
export function upgradeMissiles(world: World, ship: ShipEntity, useCopy: boolean): UpgradeError | null {
  const module = installedMissile(ship)
  if (!module) return 'maxed' // слот пуст — прокачивать нечего
  const error = canUpgrade(world, ship, module, useCopy)
  if (error) return error

  const level = useCopy ? SHOP.UPGRADE_COPY_STEP : SHOP.UPGRADE_CASH_STEP
  const upgraded = withUpgrade(module, level) as WeaponModule
  for (const i of missilePylonIndices(ship)) {
    if (ship.loadout.weapons[i] && isMunition(ship.loadout.weapons[i]!)) ship.loadout.weapons[i] = upgraded
  }
  if (useCopy) {
    const idx = upgradeCopyIndex(ship, module)
    if (idx !== null) removeItem(ship.hold, idx)
  } else {
    world.credits -= upgradeCashCost(module)
  }
  refreshSpec(ship)
  return null
}

/** Снять мунишн В ТРЮМ (весь слот, один комплект). Не влезет — операция не идёт. */
export function stripMissiles(ship: ShipEntity): StripError | null {
  const module = installedMissile(ship)
  if (!module) return 'not-installed'
  if (freeCapacity(ship.hold) < module.mass) return 'no-room'
  for (const i of missilePylonIndices(ship)) {
    if (ship.loadout.weapons[i] && isMunition(ship.loadout.weapons[i]!)) ship.loadout.weapons[i] = null
  }
  addItem(ship.hold, { kind: 'module', module })
  refreshSpec(ship)
  return null
}

/** Продать мунишн-слот целиком по остаточной цене (один комплект). */
export function sellMissiles(world: World, ship: ShipEntity): StripError | null {
  const module = installedMissile(ship)
  if (!module) return 'not-installed'
  const value = moduleResaleValue(ship, module)
  for (const i of missilePylonIndices(ship)) {
    if (ship.loadout.weapons[i] && isMunition(ship.loadout.weapons[i]!)) ship.loadout.weapons[i] = null
  }
  world.credits += value
  refreshSpec(ship)
  return null
}

// ─── Снятие и продажа установленного модуля ───────────────────────────────────

export type StripError = 'not-installed' | 'no-room' | 'essential'

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
  // Поломка сбивает цену: сломанное железо продают дешевле целого, пропорционально.
  value *= 1 - moduleFault(module)
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
