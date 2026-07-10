import { describe, expect, it } from 'vitest'
import { TRAFFIC } from '../../config/world'
import { isHostileTo } from '../ai/targeting'
import { createWorld, STARTER_SYSTEM } from './index'
import type { World } from './entities'
import { stepTraffic } from './traffic'

/**
 * Мирное движение. Космос без него — тир, а не место, где живут.
 */

function quiet(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

const neutrals = (world: World) => world.ships.filter((s) => s.faction === 'neutral')

/** Прогоняет `seconds` секунд трафика кадрами по 1/60, не двигая мир. */
function run(world: World, seconds: number): void {
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) stepTraffic(world, dt)
}

describe('мирный трафик', () => {
  it('первый торговец появляется не сразу, а спустя задержку', () => {
    const world = quiet()
    run(world, TRAFFIC.FIRST_DELAY - 1)
    expect(neutrals(world).length).toBe(0)

    run(world, 2)
    expect(neutrals(world).length).toBe(1)
  })

  /**
   * Темп задан ПЕРЕЗАРЯДОМ В СЕКУНДАХ, а не броском кости в шаге. Иначе на 120 Гц
   * торговцев рождалось бы вдвое больше, чем на 60, и трафик зависел бы от
   * частоты кадров — как когда-то зависела вся вероятностная механика.
   */
  it('число торговцев не зависит от частоты кадров', () => {
    const slow = quiet()
    const fast = quiet()

    // Меряем НИЖЕ потолка: упёршись в MAX, оба мира сравнялись бы сами,
    // и восьмикратная разница в частоте осталась бы незамеченной.
    const seconds = TRAFFIC.FIRST_DELAY + TRAFFIC.INTERVAL + 1
    for (let t = 0; t < seconds; t += 1 / 30) stepTraffic(slow, 1 / 30)
    for (let t = 0; t < seconds; t += 1 / 240) stepTraffic(fast, 1 / 240)

    expect(neutrals(slow).length).toBe(2)
    expect(neutrals(fast).length).toBe(2)
  })

  it('больше положенного в системе не летает', () => {
    const world = quiet()
    run(world, TRAFFIC.INTERVAL * (TRAFFIC.MAX + 4))
    expect(neutrals(world).length).toBe(TRAFFIC.MAX)
  })

  /** Улетевший за горизонт убирается: держать его в памяти незачем. */
  it('улетевший далеко исчезает', () => {
    const world = quiet()
    run(world, TRAFFIC.FIRST_DELAY + 1)
    const trader = neutrals(world)[0]!

    trader.state.pos.copy(world.player.state.pos).setX(TRAFFIC.DESPAWN_RANGE + 100)
    stepTraffic(world, 1 / 60)
    expect(neutrals(world).length).toBe(0)
  })

  /**
   * Захваченная цель не растворяется в рамке прицела: пилот на неё смотрит,
   * и исчезновение читается как поломка, а не как уход за пределы радара.
   */
  it('захваченный торговец не исчезает, даже улетев далеко', () => {
    const world = quiet()
    run(world, TRAFFIC.FIRST_DELAY + 1)
    const trader = neutrals(world)[0]!
    world.lockedTargetId = trader.id

    trader.state.pos.copy(world.player.state.pos).setX(TRAFFIC.DESPAWN_RANGE * 3)
    stepTraffic(world, 1 / 60)
    expect(neutrals(world).length).toBe(1)
  })

  /** Нейтрал не воюет и не является добычей — это свойство фракции, а не трафика. */
  it('торговец не враждебен никому и никому не враг', () => {
    expect(isHostileTo('neutral', 'hostile')).toBe(false)
    expect(isHostileTo('hostile', 'neutral')).toBe(false)
    expect(isHostileTo('neutral', 'player')).toBe(false)
  })

  it('торговец рождается с пилотом и с курсом на своё назначение', () => {
    const world = quiet()
    run(world, TRAFFIC.FIRST_DELAY + 1)
    const trader = neutrals(world)[0]!

    expect(trader.ai).not.toBeNull()
    expect(trader.controls.throttle).toBeGreaterThan(0)
    // Дом — это НАЗНАЧЕНИЕ, а не место рождения: иначе он закружит там, где возник.
    expect(trader.ai!.home.distanceTo(trader.state.pos)).toBeGreaterThan(1000)
  })

  /** Одно зерно — один трафик. Иначе ни сохранений, ни сети. */
  it('трафик детерминирован', () => {
    const a = quiet()
    const b = quiet()
    run(a, TRAFFIC.INTERVAL * 2)
    run(b, TRAFFIC.INTERVAL * 2)

    expect(neutrals(a).map((s) => s.state.pos.toArray())).toEqual(neutrals(b).map((s) => s.state.pos.toArray()))
  })
})
