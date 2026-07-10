import { GOVERNMENTS } from '../../config/galaxy'
import { MARKET } from '../../config/market'
import { clamp, makeRng } from '../../core/math'
import type { Commodity, CommodityStack } from '../cargo/items'
import type { Settlement } from '../galaxy/types'

/**
 * Ценообразование. Одна формула на все товары; результат — чистая функция от
 * (зерно, индекс системы, поселение, товар). Никакого локального изменяемого
 * состояния: два пилота в одной системе одного зерна получат ОДНУ И ТУ ЖЕ цену,
 * не пересылая ничего. Отсюда и сетевая синхронизация цен выйдет даром.
 *
 *   цена = база · техфактор · стройфактор · дефицит(запас)
 *
 * Живое истощение склада от покупок (когда цена реагирует на самих игроков) —
 * это уже состояние КОМНАТЫ, и жить оно будет на сервере. Пока склад выводится
 * из зерна и оттого одинаков у всех и воспроизводим.
 */

/**
 * Уклон цены по тех-уровню. У мира-производителя (разрыв ≈ 0) товар дешевле
 * каталога; чем дальше мир от родного tier товара, тем дороже. Вверх (ввоз
 * готового хайтека в отсталый мир) — круто, вниз (потребление сырья развитым
 * миром) — полого: компьютер без заводов не сделать вовсе, а руду хотя бы копают.
 */
export function techFactor(c: Commodity, s: Settlement): number {
  const gap = s.techLevel - c.tier
  const importPart = (Math.max(0, -gap) / MARKET.TECH_SPAN) * MARKET.IMPORT_SLOPE
  const consumePart = (Math.max(0, gap) / MARKET.TECH_SPAN) * MARKET.CONSUME_SLOPE
  return MARKET.PRODUCER_DISCOUNT + importPart + consumePart
}

/**
 * Надбавка строя. Легальный товар строй не трогает. Контрабанда — трогает: у
 * анархии её сбывают открыто и дёшево, под властью корпорации она из-под полы и
 * дорога. Индекс строя (анархия → корпорация) и задаёт эту шкалу.
 */
export function govFactor(c: Commodity, s: Settlement): number {
  if (!c.contraband) return 1
  const order = GOVERNMENTS.indexOf(s.government) / (GOVERNMENTS.length - 1)
  return MARKET.CONTRA_LOW + (MARKET.CONTRA_HIGH - MARKET.CONTRA_LOW) * order
}

/**
 * Запас товара на станции, ед. Детерминирован из зерна: одинаков у всех, кто
 * зашёл в эту систему. Производимый товар (дешёвый по техфактору) лежит с избытком,
 * ввозной — в обрез; крупный мир держит склад глубже (население как ёмкость рынка).
 */
export function stockLevel(c: Commodity, s: Settlement, systemIndex: number, seed: number): number {
  const rng = makeRng(seed ^ Math.imul(systemIndex + 1, 0x9e3779b1) ^ hashId(c.id))
  const jitter = MARKET.STOCK_JITTER_MIN + rng() * (MARKET.STOCK_JITTER_MAX - MARKET.STOCK_JITTER_MIN)
  const surplus = 1 / techFactor(c, s) // где дёшево — там и много
  const depth = 0.6 + Math.min(s.population, 12) / 12
  return Math.max(1, Math.round(MARKET.REF_STOCK * jitter * surplus * depth))
}

/** Дефицитная надбавка из запаса: мало на складе — дороже, завались — дешевле. */
export function scarcityFactor(stock: number): number {
  const raw = Math.sqrt(MARKET.REF_STOCK / Math.max(1, stock))
  return clamp(raw, MARKET.SCARCITY_MIN, MARKET.SCARCITY_MAX)
}

/** Справедливая местная цена единицы, кредиты. Средняя точка между покупкой и продажей. */
export function marketValue(c: Commodity, s: Settlement, systemIndex: number, seed: number): number {
  const stock = stockLevel(c, s, systemIndex, seed)
  const value = c.basePrice * techFactor(c, s) * govFactor(c, s) * scarcityFactor(stock)
  return Math.max(1, Math.round(value))
}

/**
 * Цена покупки и продажи разведены спредом вокруг справедливой: станция продаёт
 * дороже, принимает дешевле. Оттого купить и тут же сбыть — всегда убыток, а
 * прибыль живёт в разнице цен между системами. ceil/floor гарантируют buy > sell.
 */
export function unitBuyPrice(c: Commodity, s: Settlement, systemIndex: number, seed: number): number {
  return Math.ceil(marketValue(c, s, systemIndex, seed) * (1 + MARKET.SPREAD))
}

export function unitSellPrice(c: Commodity, s: Settlement, systemIndex: number, seed: number): number {
  return Math.floor(marketValue(c, s, systemIndex, seed) * (1 - MARKET.SPREAD))
}

/**
 * Абсолютная выгода от продажи всей стопки здесь: выручка минус уплаченное.
 * Плюс — в прибыль, минус — в убыток. Подобранные единицы basis не имеют и
 * входят в выручку целиком, поэтому смешанная «купил и нашёл» стопка честно
 * учитывает дармовое как чистый плюс.
 */
export function stackProfit(stack: CommodityStack, unitSell: number): number {
  return unitSell * stack.units - (stack.costBasis ?? 0)
}

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}
