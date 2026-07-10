import { describe, expect, it } from 'vitest'
import { COMMODITIES } from '../cargo/items'
import type { Settlement } from '../galaxy/types'
import {
  govFactor,
  marketValue,
  scarcityFactor,
  stackProfit,
  stockLevel,
  techFactor,
  unitBuyPrice,
  unitSellPrice,
} from './market'

/**
 * Рынок.
 *
 * Проверяем СВОЙСТВА ценообразования, а не числа: «хайтек дороже в отсталом мире»
 * переживёт любую перебалансировку наклонов, а `toBe(1234)` сломается от первой же
 * правки коэффициента. Числа рынка живут в конфиге, тесты стерегут их смысл.
 */

const SEED = 12345
const INDEX = 42

/** Поселение с заданным тех-уровнем и строем; остальное неважно для цены. */
function settlement(techLevel: number, government: Settlement['government'] = 'Демократия'): Settlement {
  return { economy: 'Промышленная', government, techLevel, population: 3, species: '—' }
}

const FOOD = COMMODITIES.FOOD // tier 2 — сырьё, родина внизу шкалы
const ELECTRONICS = COMMODITIES.ELECTRONICS // tier 11 — хайтек, родина наверху
const NARCOTICS = COMMODITIES.NARCOTICS // контрабанда

describe('рынок: цена от уровня развития', () => {
  it('готовый хайтек дороже там, где его не делают', () => {
    // Электроника в отсталом аграрном мире дороже, чем в развитом: его ввозят.
    const backward = marketValue(ELECTRONICS, settlement(3), INDEX, SEED)
    const advanced = marketValue(ELECTRONICS, settlement(13), INDEX, SEED)
    expect(backward).toBeGreaterThan(advanced)
  })

  it('сырьё дороже там, где его потребляют, а не добывают', () => {
    // Еду развитый мир ввозит и переплачивает; аграрий сбывает её за бесценок.
    const advanced = marketValue(FOOD, settlement(13), INDEX, SEED)
    const agrarian = marketValue(FOOD, settlement(2), INDEX, SEED)
    expect(advanced).toBeGreaterThan(agrarian)
  })

  it('у мира-производителя товар дешевле каталога', () => {
    // На родном tier техфактор — это скидка производителя, ниже единицы.
    expect(techFactor(ELECTRONICS, settlement(ELECTRONICS.tier))).toBeLessThan(1)
    expect(techFactor(FOOD, settlement(FOOD.tier))).toBeLessThan(1)
  })
})

describe('рынок: строй и контрабанда', () => {
  it('контрабанда дороже под властью порядка, чем при анархии', () => {
    const anarchy = marketValue(NARCOTICS, settlement(6, 'Анархия'), INDEX, SEED)
    const corporate = marketValue(NARCOTICS, settlement(6, 'Корпорация'), INDEX, SEED)
    expect(corporate).toBeGreaterThan(anarchy)
  })

  it('легальный товар строй не трогает', () => {
    expect(govFactor(FOOD, settlement(6, 'Анархия'))).toBe(1)
    expect(govFactor(FOOD, settlement(6, 'Корпорация'))).toBe(1)
  })
})

describe('рынок: спрос и предложение', () => {
  it('чем меньше на складе, тем дороже', () => {
    // Дефицитный фактор строго убывает с запасом: мало — дорого, завались — дёшево.
    expect(scarcityFactor(10)).toBeGreaterThan(scarcityFactor(90))
    expect(scarcityFactor(90)).toBeGreaterThan(scarcityFactor(400))
  })

  it('запас детерминирован: то же зерно — тот же склад', () => {
    const a = stockLevel(FOOD, settlement(5), INDEX, SEED)
    const b = stockLevel(FOOD, settlement(5), INDEX, SEED)
    expect(a).toBe(b)
    // Другая система — другой склад: иначе рынок везде одинаков.
    expect(stockLevel(FOOD, settlement(5), INDEX + 1, SEED)).not.toBe(a)
  })
})

describe('рынок: спред и перевозка', () => {
  it('купить и тут же продать на месте — всегда убыток', () => {
    // Один и тот же прилавок: покупка строго выше приёма. Инвариант экономики.
    const s = settlement(7)
    expect(unitBuyPrice(FOOD, s, INDEX, SEED)).toBeGreaterThan(unitSellPrice(FOOD, s, INDEX, SEED))
  })

  it('перевозка между системами с разными ценами приносит прибыль', () => {
    // Купить электронику у высокотеха, продать аграрию — в плюс даже со спредом.
    const buyAtSource = unitBuyPrice(ELECTRONICS, settlement(13), INDEX, SEED)
    const sellAtDest = unitSellPrice(ELECTRONICS, settlement(3), INDEX + 7, SEED)
    expect(sellAtDest).toBeGreaterThan(buyAtSource)
  })
})

describe('рынок: выгода на продаже', () => {
  it('прибыль = выручка минус уплаченное', () => {
    const stack = { kind: 'commodity' as const, commodity: FOOD, units: 4, costBasis: 400 }
    // Продаём по 120 за штуку: 480 выручки минус 400 входа = +80.
    expect(stackProfit(stack, 120)).toBe(80)
    // По 80: 320 − 400 = −80, убыток.
    expect(stackProfit(stack, 80)).toBe(-80)
  })

  it('находка без цены входа — вся выручка в плюс', () => {
    // costBasis нет: подобранный груз достался даром.
    const loot = { kind: 'commodity' as const, commodity: FOOD, units: 5 }
    expect(stackProfit(loot, 100)).toBe(500)
  })

  it('смешанная стопка учитывает найденное как чистый плюс', () => {
    // Куплено 3 за 300 (basis 300), подобрано ещё 2 даром — итого 5 единиц.
    const mixed = { kind: 'commodity' as const, commodity: FOOD, units: 5, costBasis: 300 }
    // Продажа по 100: 500 − 300 = 200. Найденные две (200 кр.) целиком в прибыль.
    expect(stackProfit(mixed, 100)).toBe(200)
  })
})
