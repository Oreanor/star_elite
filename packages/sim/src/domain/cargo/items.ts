import type { ShipModule } from '../loadout'

/**
 * Содержимое трюма. Два вида: сыпучий товар и снятый модуль.
 * Различающее поле — `kind`, чтобы TypeScript сужал тип без приведений.
 */

export interface Commodity {
  id: string
  name: string
  /** Одна строка описания — флейвор для карточки товара. Канон RU, перевод в UI по id. */
  description: string
  /** Масса одной единицы, т. */
  unitMass: number
  /** Базовая цена за единицу, кредиты. */
  basePrice: number
  /**
   * «Родной» тех-уровень товара, 1..15 — на нём его производят с избытком и дёшево.
   * Из разрыва между ним и тех-уровнем системы рынок и выводит цену: у своего мира
   * дёшево, чем дальше мир от него — тем дороже ввоз. Еда рождается внизу шкалы,
   * электроника наверху; это единственное, чем категории различаются в формуле цены.
   */
  tier: number
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
  /**
   * Сколько кредитов суммарно уплачено за единицы, лежащие в стопке. Нужно, чтобы
   * на продаже показать выгоду: прибыль = выручка − costBasis. Добыча и трофеи
   * достаются даром, у них basis нет (undefined) — значит вся выручка в плюс.
   * Смешанная стопка (купил и подобрал) хранит basis только за купленное, и
   * подобранные единицы честно считаются чистой прибылью.
   *
   * Это ЛИЧНАЯ история игрока, а не свойство рынка: в сетевой игре она не
   * синхронизируется — у каждого своя цена входа.
   */
  costBasis?: number
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
  SCRAP: { id: 'scrap', name: 'Лом', description: 'Мятый металл и мёртвая электроника. Дёшев везде, нужен переработчикам.', unitMass: 1, basePrice: 60, tier: 1, contraband: false },
  FOOD: { id: 'food', name: 'Еда', description: 'Синтетический паёк и живые культуры. Возят все, платят мало.', unitMass: 1, basePrice: 42, tier: 2, contraband: false },
  MINERALS: { id: 'minerals', name: 'Руда', description: 'Необогащённая порода из поясов астероидов. Сырьё для металлургии.', unitMass: 1, basePrice: 180, tier: 3, contraband: false },
  METALS: { id: 'metals', name: 'Металлы', description: 'Очищенные слитки и сплавы. Хлеб тяжёлой промышленности.', unitMass: 1, basePrice: 420, tier: 6, contraband: false },
  MACHINERY: { id: 'machinery', name: 'Машинерия', description: 'Станки, приводы, запчасти. Дорога там, где нечем строить.', unitMass: 1, basePrice: 640, tier: 8, contraband: false },
  ELECTRONICS: { id: 'electronics', name: 'Электроника', description: 'Платы и чипы высокого передела. Лёгкая, дорогая, нужна всем.', unitMass: 0.5, basePrice: 980, tier: 11, contraband: false },
  // Контрабанду плодят беззаконные окраины (низкий tier), а спрос на неё — в богатых
  // законопослушных мирах: оттого её и возят снизу вверх, рискуя штрафом.
  SLAVES: { id: 'slaves', name: 'Рабы', description: 'Живой груз. Вне закона в цивилизованных мирах — оттого и в цене.', unitMass: 1, basePrice: 1240, tier: 3, contraband: true },
  LUXURIES: { id: 'luxuries', name: 'Роскошь', description: 'Редкости для тех, кому некуда девать деньги. Малый вес, крупный навар.', unitMass: 0.5, basePrice: 1850, tier: 12, contraband: false },
  NARCOTICS: { id: 'narcotics', name: 'Наркотики', description: 'Запрещённая химия. Дорога, компактна и пахнет штрафом.', unitMass: 0.4, basePrice: 2900, tier: 9, contraband: true },
} as const satisfies Record<string, Commodity>
