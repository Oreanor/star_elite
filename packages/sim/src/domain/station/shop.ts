import { SHOP } from '../../config/station'
import { addCommodity, freeCapacity, removeItem } from '../cargo/hold'
import { COMMODITIES, itemValue, type Commodity } from '../cargo/items'
import { isMissile, isWeapon, type ShipModule } from '../loadout'
import type { ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'

/**
 * Торговля и ремонт. Чистые правила: ни одного обращения к UI.
 *
 * Ремонтируем только корпус. Щит восстанавливается сам — брать за это деньги
 * значило бы продавать время.
 */

export function hullDamage(ship: ShipEntity): number {
  return Math.max(0, ship.spec.hull.hull - ship.hull)
}

export function repairCost(ship: ShipEntity): number {
  return Math.ceil(hullDamage(ship) * SHOP.HULL_REPAIR_COST)
}

export function repair(world: World, ship: ShipEntity): boolean {
  const cost = repairCost(ship)
  if (cost === 0 || world.credits < cost) return false

  world.credits -= cost
  ship.hull = ship.spec.hull.hull
  return true
}

export function priceOf(module: ShipModule): number {
  return Math.ceil(module.cost * SHOP.MARKUP)
}

export function resaleOf(module: ShipModule): number {
  return Math.floor(module.cost * SHOP.RESALE)
}

export type PurchaseError = 'no-money' | 'wrong-kind' | 'class-too-large' | 'no-hardpoint' | 'already-installed'

/** Слоты корпуса под этот вид модуля, в которые он влезает по классу. */
function fittingSlots(ship: ShipEntity, module: ShipModule): number {
  return ship.loadout.chassis.slots.filter((s) => s.kind === module.kind && s.maxClass >= module.class).length
}

function installedOfKind(ship: ShipEntity, kind: ShipModule['kind']): ShipModule[] {
  return ship.loadout.internals.filter((m) => m.kind === kind)
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
    if (hardpoint.maxClass < module.class) return 'class-too-large'
    if (ship.loadout.weapons[hardpointIndex]?.id === module.id) return 'already-installed'
    return null
  }

  const slots = fittingSlots(ship, module)
  if (slots === 0) {
    // Слот под такой вид есть, но модуль в него не лезет по классу — или вида нет вовсе.
    const anyKind = ship.loadout.chassis.slots.some((s) => s.kind === module.kind)
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
  return null
}

/** Что станция может предложить. Пока — весь каталог: ассортимент придёт из StarSystem. */
export function stock(catalogue: readonly ShipModule[]): readonly ShipModule[] {
  return catalogue.filter((m) => m.cost > 0)
}

// ─── Груз ────────────────────────────────────────────────────────────────────

/** Сколько стоит всё, что лежит в трюме. Трофеи и добыча — основной доход пилота. */
export function cargoValue(ship: ShipEntity): number {
  let total = 0
  for (const item of ship.hold.items) total += itemValue(item)
  return total
}

/** Прилавок станции. Пока весь каталог: ассортимент придёт из StarSystem. */
export function commodityStock(): readonly Commodity[] {
  return Object.values(COMMODITIES)
}

/** Цена покупки единицы. Продаёт станция дороже, чем принимает (`itemValue`). */
export function commodityPrice(commodity: Commodity): number {
  return Math.ceil(commodity.basePrice * SHOP.COMMODITY_MARKUP)
}

export type TradeError = 'no-money' | 'no-room'

/**
 * Проверка покупки БЕЗ побочных эффектов — ею UI гасит кнопку, ею же `buyCommodity`
 * решает, продавать ли. Две независимые проверки однажды разошлись бы.
 */
export function canBuyCommodity(world: World, ship: ShipEntity, commodity: Commodity): TradeError | null {
  if (world.credits < commodityPrice(commodity)) return 'no-money'
  if (freeCapacity(ship.hold) < commodity.unitMass) return 'no-room'
  return null
}

/**
 * Купить сколько-то единиц товара. Берём столько, сколько влезает И на сколько
 * хватает денег: отказать целиком там, где можно продать половину, — плохая лавка.
 *
 * @returns купленное количество, ноль — если не вышло ничего.
 */
export function buyCommodity(world: World, ship: ShipEntity, commodity: Commodity, units: number): number {
  const price = commodityPrice(commodity)
  if (price <= 0 || units <= 0) return 0

  const affordable = Math.floor(world.credits / price)
  const fits = Math.floor(freeCapacity(ship.hold) / commodity.unitMass)
  const taken = Math.min(units, affordable, fits)
  if (taken <= 0) return 0

  const added = addCommodity(ship.hold, commodity, taken)
  if (added <= 0) return 0

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

  const value = itemValue(item)
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
  const value = cargoValue(ship)
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
