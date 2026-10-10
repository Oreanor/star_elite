import { addCommodity, freeCapacity, removeItem } from '../cargo/hold'
import { COMMODITIES, itemValue, type CargoItem, type Commodity } from '../cargo/items'
import { settlementAt } from '../galaxy/generate'
import type { Settlement } from '../galaxy/types'
import type { ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'
import { stockLevel, unitBuyPrice, unitSellPrice } from './market'
import { issueFine, localFine } from './legal'

/**
 * Торговля грузом на станции: цены от рынка поселения, покупка и продажа товара, стоимость трюма.
 */

/**
 * Поселение-столица, чьей станцией сейчас торгует пилот. Выводится из зерна
 * системы (см. `settlementAt`) — не хранится в мире и оттого одинаково у всех,
 * кто зашёл в ту же систему. На нём и держится будущая сетевая синхронизация цен.
 */
export const NEUTRAL_MARKET: Settlement = {
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

/** Прилавок станции. Каталог без коллекционных статуэток — их только находят в системе. */
export function commodityStock(): readonly Commodity[] {
  return Object.values(COMMODITIES).filter((c) => c.id !== COMMODITIES.FIGURINE.id)
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

export type TradeError = 'no-money' | 'no-room' | 'local-fine'

/**
 * Проверка покупки БЕЗ побочных эффектов — ею UI гасит кнопку, ею же `buyCommodity`
 * решает, продавать ли. Две независимые проверки однажды разошлись бы.
 */
export function canBuyCommodity(world: World, ship: ShipEntity, commodity: Commodity): TradeError | null {
  if (localFine(world)) return 'local-fine'
  if (world.credits < commodityBuyPrice(world, commodity)) return 'no-money'
  // Масса 0 (статуэтки) места не занимает.
  if (commodity.unitMass > 0 && freeCapacity(ship.hold) < commodity.unitMass) return 'no-room'
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
  if (localFine(world)) return 0
  const price = commodityBuyPrice(world, commodity)
  if (price <= 0 || units <= 0) return 0

  // Перевозка сама по себе разрешена. Нарушение возникает только в момент
  // торговой операции: попытка купить запрещённый товар сразу фиксирует долг,
  // а товар не переходит в трюм.
  if (commodity.contraband) {
    issueFine(world, Math.max(100, Math.floor(price * units * 0.25)), 'illegal-purchase')
    return 0
  }

  const affordable = Math.floor(world.credits / price)
  const fits =
    commodity.unitMass <= 0
      ? units
      : Math.floor(freeCapacity(ship.hold) / commodity.unitMass)
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
  if (localFine(world)) return 0
  const item = ship.hold.items[index]
  if (!item) return 0

  const value = itemSellValue(world, item)
  if (item.kind === 'commodity' && item.commodity.contraband) {
    issueFine(world, Math.max(100, Math.floor(value * 0.25)), 'illegal-sale')
  }
  removeItem(ship.hold, index)
  world.credits += value
  refreshSpec(ship)
  return value
}

/** Сколько единиц этого товара уже в трюме — источник максимума для ползунка продажи. */
export function commodityHeld(ship: ShipEntity, commodity: Commodity): number {
  const stack = ship.hold.items.find(
    (i): i is Extract<CargoItem, { kind: 'commodity' }> =>
      i.kind === 'commodity' && i.commodity.id === commodity.id,
  )
  return stack?.units ?? 0
}

/**
 * Продать N единиц конкретного товара — для ползунка «продать столько-то». В отличие
 * от sellItem (весь предмет по индексу) берёт ЧАСТЬ стопки: costBasis режется
 * пропорционально проданной доле, чтобы выгода на остатке считалась честно.
 *
 * @returns выручка, ноль — если такого товара нет или units<=0.
 */
export function sellCommodity(world: World, ship: ShipEntity, commodity: Commodity, units: number): number {
  if (localFine(world)) return 0
  if (units <= 0) return 0
  const stack = ship.hold.items.find(
    (i): i is Extract<CargoItem, { kind: 'commodity' }> =>
      i.kind === 'commodity' && i.commodity.id === commodity.id,
  )
  if (!stack) return 0

  const sold = Math.min(units, stack.units)
  if (sold <= 0) return 0

  const value = commoditySellPrice(world, commodity) * sold
  if (commodity.contraband) issueFine(world, Math.max(100, Math.floor(value * 0.25)), 'illegal-sale')
  // Цену входа режем пропорционально: остаток хранит basis только своих единиц.
  if (stack.costBasis !== undefined) {
    stack.costBasis = sold >= stack.units ? 0 : Math.round(stack.costBasis * ((stack.units - sold) / stack.units))
  }
  stack.units -= sold
  if (stack.units <= 0) {
    const idx = ship.hold.items.indexOf(stack)
    if (idx >= 0) removeItem(ship.hold, idx)
  }
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
  if (localFine(world)) return 0
  const value = holdSellValue(world, ship)
  if (value === 0) return 0

  for (const item of ship.hold.items) {
    if (item.kind === 'commodity' && item.commodity.contraband) {
      issueFine(world, Math.max(100, Math.floor(itemSellValue(world, item) * 0.25)), 'illegal-sale')
    }
  }
  world.credits += value
  ship.hold.items.length = 0
  refreshSpec(ship)
  return value
}
