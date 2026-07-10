import { itemMass, type CargoItem, type Commodity } from './items'

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
      return true
    }
  }
  hold.items.push(item)
  return true
}

/** Кладёт столько единиц товара, сколько влезет. Возвращает принятое количество. */
export function addCommodity(hold: CargoHold, commodity: Commodity, units: number): number {
  const fits = Math.floor(freeCapacity(hold) / commodity.unitMass)
  const taken = Math.min(units, fits)
  if (taken > 0) addItem(hold, { kind: 'commodity', commodity, units: taken })
  return taken
}

export function removeItem(hold: CargoHold, index: number): CargoItem | null {
  const [removed] = hold.items.splice(index, 1)
  return removed ?? null
}

/** Пересобрать вместимость после смены грузовых контейнеров. */
export function setCapacity(hold: CargoHold, capacity: number): void {
  hold.capacity = capacity
}
