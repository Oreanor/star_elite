import { describe, expect, it } from 'vitest'
import { TIME } from '../../config/time'
import { COMMODITIES } from '../cargo/items'
import { applyPlayerSave, serializePlayer } from '../save/player'
import { quietWorld } from '../../testkit'
import { buyCommodity, commodityBuyPrice, commodityStockAt } from './trade'

/**
 * СКЛАД СТАНЦИИ. Пойманное: выкупил на станции всё, что было, — а запас как стоял, так и стоит:
 * он был чистой функцией зерна, и покупка его не трогала. Теперь выкупленное уходит со склада
 * и возвращается лишь позже, порциями случайной величины раз в игровые сутки.
 */

const FOOD = COMMODITIES.FOOD
const DAY = 86_400 / TIME.SCALE

function richWorld() {
  const world = quietWorld()
  world.credits = 1e12
  world.player.hold.capacity = 1e9
  return world
}

describe('склад станции', () => {
  it('выкупил всё — пусто, и больше не продают', () => {
    const world = richWorld()
    const stock = commodityStockAt(world, FOOD)
    expect(stock).toBeGreaterThan(0)
    expect(buyCommodity(world, world.player, FOOD, stock + 1000)).toBe(stock)
    expect(commodityStockAt(world, FOOD)).toBe(0)
    expect(buyCommodity(world, world.player, FOOD, 1)).toBe(0)
  })

  it('дефицит дороже: выкупленный товар стоит больше, чем полный склад', () => {
    const world = richWorld()
    const full = commodityBuyPrice(world, FOOD)
    buyCommodity(world, world.player, FOOD, Math.floor(commodityStockAt(world, FOOD) * 0.9))
    expect(commodityBuyPrice(world, FOOD)).toBeGreaterThan(full)
  })

  it('подвозят не сразу, а позже — порциями, пока склад не вернётся к норме', () => {
    const world = richWorld()
    const base = commodityStockAt(world, FOOD)
    buyCommodity(world, world.player, FOOD, base)
    const t0 = world.calendarTime

    // В те же сутки — пусто.
    world.calendarTime = t0 + DAY * 0.01
    expect(commodityStockAt(world, FOOD)).toBe(0)

    // Через сутки-другие — часть, но не всё: порция, а не мгновенный полный склад.
    world.calendarTime = t0 + DAY * 1.5
    const later = commodityStockAt(world, FOOD)
    expect(later).toBeGreaterThan(0)
    expect(later).toBeLessThan(base)

    // Спустя долгое время — снова норма, не больше.
    world.calendarTime = t0 + DAY * 60
    expect(commodityStockAt(world, FOOD)).toBe(base)
  })

  it('пополнение одно у всех: та же станция и тот же миг — тот же склад', () => {
    const a = richWorld()
    const b = richWorld()
    const base = commodityStockAt(a, FOOD)
    buyCommodity(a, a.player, FOOD, base)
    buyCommodity(b, b.player, FOOD, base)
    a.calendarTime = b.calendarTime = a.calendarTime + DAY * 3.2
    expect(commodityStockAt(a, FOOD)).toBe(commodityStockAt(b, FOOD))
  })

  it('выкупленное не воскресает перезагрузкой', () => {
    const world = richWorld()
    buyCommodity(world, world.player, FOOD, commodityStockAt(world, FOOD))
    const save = serializePlayer(world)
    const fresh = richWorld()
    applyPlayerSave(fresh, save)
    expect(commodityStockAt(fresh, FOOD)).toBe(0)
  })

  it('выкупил перед полуночью — подвоз всё равно не раньше суток', () => {
    // Отсчёт — от сделки, а не от границы календарных суток: иначе склад «пополнялся» через минуту.
    const world = richWorld()
    world.calendarTime = DAY * 5 - 1
    const base = commodityStockAt(world, FOOD)
    buyCommodity(world, world.player, FOOD, base)
    world.calendarTime = DAY * 5 + DAY * 0.5
    expect(commodityStockAt(world, FOOD)).toBe(0)
    world.calendarTime = DAY * 6 + 1
    expect(commodityStockAt(world, FOOD)).toBeGreaterThan(0)
  })
})

