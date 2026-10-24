import { COMMODITIES, itemMass, type CargoItem, type Commodity, type FigurineSpecimen } from './items'

/**
 * Трюм. Вместимость приходит из установленных грузовых контейнеров,
 * а масса содержимого возвращается в физику — гружёный корабль летает хуже.
 */
export interface CargoHold {
  capacity: number
  items: CargoItem[]
}

export function createHold(capacity: number): CargoHold {
  return { capacity, items: [] }
}

export function usedCapacityOf(hold: CargoHold): number {
  let m = 0
  for (const item of hold.items) m += itemMass(item)
  return m
}

export function freeCapacity(hold: CargoHold): number {
  return Math.max(0, hold.capacity - usedCapacityOf(hold))
}

/** Масса груза, т. Идёт прямо в deriveShipSpec. */
export const cargoMass = usedCapacityOf

/**
 * Кладёт предмет, если хватает места.
 * Одинаковые товары складываются в стопку — иначе трюм превратится в свалку.
 */
export function addItem(hold: CargoHold, item: CargoItem): boolean {
  if (itemMass(item) > freeCapacity(hold)) return false

  if (item.kind === 'commodity') {
    const stack = hold.items.find(
      (i): i is Extract<CargoItem, { kind: 'commodity' }> =>
        i.kind === 'commodity' && i.commodity.id === item.commodity.id,
    )
    if (stack) {
      stack.units += item.units
      // Складываем и уплаченное: иначе, докупив к уже лежащему товару, потеряли бы
      // цену входа и не смогли бы показать выгоду. Стопка без basis + покупка с
      // basis даёт basis только за купленное — подобранное так и остаётся даром.
      if (item.costBasis !== undefined) stack.costBasis = (stack.costBasis ?? 0) + item.costBasis
      // Статуэтки — экземпляры с именами: без слияния `specimens` бот теряет названия.
      if (item.commodity.id === COMMODITIES.FIGURINE.id) {
        stack.specimens = [...(stack.specimens ?? []), ...(item.specimens ?? [])]
      }
      return true
    }
  }
  hold.items.push(item)
  return true
}

/** Сколько единиц этого товара уже лежит. Нет стопки — ноль. */
export function commodityUnits(hold: CargoHold, commodityId: string): number {
  for (const item of hold.items) {
    if (item.kind === 'commodity' && item.commodity.id === commodityId) return item.units
  }
  return 0
}

/**
 * Забрать единицы из стопки. Возвращает, сколько реально ушло.
 * Цена входа режется пропорционально остатку — иначе продажа остатка врала бы выгоду.
 */
export function takeCommodity(hold: CargoHold, commodityId: string, units: number): number {
  const idx = hold.items.findIndex((i) => i.kind === 'commodity' && i.commodity.id === commodityId)
  const stack = hold.items[idx]
  if (!stack || stack.kind !== 'commodity' || units <= 0) return 0
  const taken = Math.min(units, stack.units)
  const left = stack.units - taken
  if (stack.costBasis !== undefined) {
    stack.costBasis = left > 0 ? stack.costBasis * (left / stack.units) : undefined
  }
  if (left <= 0) hold.items.splice(idx, 1)
  else stack.units = left
  return taken
}

/** Кладёт столько единиц товара, сколько влезет. Возвращает принятое количество. */
export function addCommodity(hold: CargoHold, commodity: Commodity, units: number): number {
  // Масса 0 (статуэтки): место не занимает — влезает всё запрошенное.
  // Без `specimens` — только сырой счётчик; коллекцию кладут через `addFigurineSpecimens`.
  if (commodity.unitMass <= 0) {
    if (units > 0) addItem(hold, { kind: 'commodity', commodity, units })
    return units
  }
  const fits = Math.floor(freeCapacity(hold) / commodity.unitMass)
  const taken = Math.min(units, fits)
  if (taken > 0) addItem(hold, { kind: 'commodity', commodity, units: taken })
  return taken
}

/** Положить именованные статуэтки в трюм (масса 0 — всегда влезают). */
export function addFigurineSpecimens(hold: CargoHold, specimens: FigurineSpecimen[]): void {
  if (specimens.length === 0) return
  addItem(hold, {
    kind: 'commodity',
    commodity: COMMODITIES.FIGURINE,
    units: specimens.length,
    specimens: [...specimens],
  })
}

export function removeItem(hold: CargoHold, index: number): CargoItem | null {
  const [removed] = hold.items.splice(index, 1)
  return removed ?? null
}
