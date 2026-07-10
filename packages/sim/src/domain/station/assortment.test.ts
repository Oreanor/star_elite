import { describe, expect, it } from 'vitest'
import { createWorld } from '../world'
import { MODULE_CATALOGUE } from '../../config/modules'
import type { Settlement } from '../galaxy/types'
import { stationStock, stockChance } from './shop'

/**
 * Ассортимент станции. Проверяем ИНВАРИАНТЫ, а не конкретный список: он выведен из
 * зерна и обязан быть одинаков у всех в системе, но не совпадать между системами.
 */

function settlement(techLevel: number): Settlement {
  return { economy: 'Промышленная', government: 'Демократия', techLevel, population: 4, species: '—' }
}

describe('ассортимент станции', () => {
  it('одинаков между вызовами: витрина детерминирована из зерна', () => {
    const world = createWorld()
    const a = stationStock(world).map((m) => m.id)
    const b = stationStock(world).map((m) => m.id)
    expect(a).toEqual(b)
  })

  it('на прилавок не попадает бесплатный стартовый хлам', () => {
    const world = createWorld()
    for (const m of stationStock(world)) expect(m.cost).toBeGreaterThan(0)
  })

  it('витрина — подмножество каталога, ничего лишнего', () => {
    const world = createWorld()
    const ids = new Set(MODULE_CATALOGUE.map((m) => m.id))
    for (const m of stationStock(world)) expect(ids.has(m.id)).toBe(true)
  })

  it('развитость поднимает шанс, класс — опускает: развитый мир держит выбор богаче', () => {
    // Свойство самой формулы, без бросков: монотонность по тех-уровню и по классу.
    const cls1 = MODULE_CATALOGUE.find((m) => m.class === 1)!
    const cls3 = MODULE_CATALOGUE.find((m) => m.class === 3)!

    // Тех-уровень вверх — шанс не падает.
    expect(stockChance(cls1, settlement(14))).toBeGreaterThan(stockChance(cls1, settlement(2)))
    // Тот же мир: старший класс встречается реже младшего.
    expect(stockChance(cls3, settlement(8))).toBeLessThan(stockChance(cls1, settlement(8)))
  })
})
