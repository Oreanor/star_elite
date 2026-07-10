import type { ShipModule } from '../loadout'

/**
 * Содержимое трюма. Два вида: сыпучий товар и снятый модуль.
 * Различающее поле — `kind`, чтобы TypeScript сужал тип без приведений.
 */

export interface Commodity {
  id: string
  name: string
  /** Масса одной единицы, т. */
  unitMass: number
  /** Базовая цена за единицу, кредиты. */
  basePrice: number
  /**
   * Запрещённый груз. Пока это только метка на товаре — досмотра в игре нет.
   * Но цена рабов и наркотиков назначена ИЗ-ЗА неё: они дороги именно потому,
   * что за них полагается штраф. Как только появится полиция, метка уже здесь.
   */
  contraband: boolean
}

export interface CommodityStack {
  kind: 'commodity'
  commodity: Commodity
  units: number
}

export interface ModuleItem {
  kind: 'module'
  module: ShipModule
}

export type CargoItem = CommodityStack | ModuleItem

export function itemMass(item: CargoItem): number {
  return item.kind === 'commodity'
    ? item.commodity.unitMass * item.units
    : item.module.mass
}

export function itemValue(item: CargoItem): number {
  return item.kind === 'commodity'
    ? item.commodity.basePrice * item.units
    // Снятый модуль продаётся дешевле нового: он побывал в бою.
    : Math.round(item.module.cost * 0.45)
}

export function itemName(item: CargoItem): string {
  return item.kind === 'commodity'
    ? `${item.commodity.name} ×${item.units}`
    : item.module.name
}

/**
 * Товарная номенклатура. Порядок — по возрастанию цены, и он же читается как
 * лестница риска: еду возят все, наркотики — те, кому нечего терять.
 *
 * Лёгкий и дорогой груз выгоднее возить: тонна наркотиков стоит как двадцать
 * тонн еды и занимает меньше места. Поэтому масса единицы у дорогих товаров
 * ниже — иначе выбор товара сводился бы к «взять самое дорогое», и торговли нет.
 */
export const COMMODITIES = {
  SCRAP: { id: 'scrap', name: 'Лом', unitMass: 1, basePrice: 60, contraband: false },
  FOOD: { id: 'food', name: 'Еда', unitMass: 1, basePrice: 42, contraband: false },
  MINERALS: { id: 'minerals', name: 'Руда', unitMass: 1, basePrice: 180, contraband: false },
  METALS: { id: 'metals', name: 'Металлы', unitMass: 1, basePrice: 420, contraband: false },
  MACHINERY: { id: 'machinery', name: 'Машинерия', unitMass: 1, basePrice: 640, contraband: false },
  ELECTRONICS: { id: 'electronics', name: 'Электроника', unitMass: 0.5, basePrice: 980, contraband: false },
  SLAVES: { id: 'slaves', name: 'Рабы', unitMass: 1, basePrice: 1240, contraband: true },
  LUXURIES: { id: 'luxuries', name: 'Роскошь', unitMass: 0.5, basePrice: 1850, contraband: false },
  NARCOTICS: { id: 'narcotics', name: 'Наркотики', unitMass: 0.4, basePrice: 2900, contraband: true },
} as const satisfies Record<string, Commodity>
