import { GOVERNMENTS } from '../../config/galaxy'
import { MARKET } from '../../config/market'
import { TIME } from '../../config/time'
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
export function marketValue(
  c: Commodity,
  s: Settlement,
  systemIndex: number,
  seed: number,
  /** Текущий запас (с учётом выкупленного); по умолчанию — исходный из зерна. */
  stock: number = stockLevel(c, s, systemIndex, seed),
): number {
  const value = c.basePrice * techFactor(c, s) * govFactor(c, s) * scarcityFactor(stock)
  return Math.max(1, Math.round(value))
}

/**
 * Цена покупки и продажи разведены спредом вокруг справедливой: станция продаёт
 * дороже, принимает дешевле. Оттого купить и тут же сбыть — всегда убыток, а
 * прибыль живёт в разнице цен между системами. ceil/floor гарантируют buy > sell.
 */
export function unitBuyPrice(c: Commodity, s: Settlement, systemIndex: number, seed: number, stock?: number): number {
  return Math.ceil(marketValue(c, s, systemIndex, seed, stock) * (1 + MARKET.SPREAD))
}

export function unitSellPrice(c: Commodity, s: Settlement, systemIndex: number, seed: number, stock?: number): number {
  return Math.floor(marketValue(c, s, systemIndex, seed, stock) * (1 - MARKET.SPREAD))
}

/**
 * Запись склада о товаре: на сколько он отличается от исходного (`delta`: выкуплено — плюс,
 * сдано сверх — минус) на момент `at` — отсчёт подвоза: первый не раньше суток после него.
 */
export interface StockEntry {
  delta: number
  at: number
}

/** Игровые сутки в единицах календаря мира (календарь при показе ускорен ×TIME.SCALE). */
const GAME_DAY = 86_400 / TIME.SCALE

/**
 * Склад на момент `t`: запись `entry` тает к нулю порциями — первая через RESTOCK_EVERY_DAYS
 * суток после `at`, дальше с тем же шагом. Порция — доля исходного запаса `base`, бросок из
 * `key` и номера подвоза: детерминировано и без истории — сколько ни пройдёт, считается заново.
 * Возвращает отклонение и момент последнего подвоза — от него идёт отсчёт следующего, поэтому
 * новая сделка не откладывает подвоз уже выкупленного.
 */
export function stockAt(entry: StockEntry, base: number, key: number, t: number): StockEntry {
  const period = MARKET.RESTOCK_EVERY_DAYS * GAME_DAY
  let delta = entry.delta
  const steps = Math.max(0, Math.floor((t - entry.at) / period))
  const first = Math.floor(entry.at / period)
  let n = 0
  for (; n < steps && delta !== 0; n++) {
    const u = makeRng((key ^ Math.imul(first + n + 1, 0x9e3779b1)) >>> 0)()
    const portion = Math.max(1, base * (MARKET.RESTOCK_MIN_FRAC + u * (MARKET.RESTOCK_MAX_FRAC - MARKET.RESTOCK_MIN_FRAC)))
    delta = delta > 0 ? Math.max(0, delta - portion) : Math.min(0, delta + portion)
  }
  return { delta, at: entry.at + n * period }
}

/** Ключ склада товара на станции системы: тот же, что у исходного запаса в `stockLevel`. */
export function stockKey(c: Commodity, systemIndex: number, seed: number): number {
  return (seed ^ Math.imul(systemIndex + 1, 0x9e3779b1) ^ hashId(c.id)) >>> 0
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
