import { describe, expect, it } from 'vitest'
import { TRAFFIC } from '../../config/world'
import { isHostileTo } from '../ai/targeting'
import { createWorld, STARTER_SYSTEM } from './index'
import type { ShipEntity, World } from './entities'
import { stepTraffic } from './traffic'

/**
 * Встречи. Космос без них — тир, а не место, где живут; но и встреча по
 * расписанию перестаёт быть встречей.
 */

function quiet(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

/** Без станции: она рожает мирных у причала, и дистанция появления не проверяется. */
function deepSpace(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null, station: null })
}

const met = (world: World): ShipEntity[] => world.ships

/** Прогоняет `seconds` секунд трафика кадрами по 1/60, не двигая мир. */
function run(world: World, seconds: number, dt = 1 / 60): void {
  for (let t = 0; t < seconds; t += dt) stepTraffic(world, dt)
}

describe('встречи в космосе', () => {
  it('до первой задержки не приходит никто', () => {
    const world = quiet()
    run(world, TRAFFIC.FIRST_DELAY - 1)
    expect(met(world)).toHaveLength(0)
  })

  /**
   * Темп задан ПЕРЕЗАРЯДОМ В СЕКУНДАХ, а не броском кости в шаге. Иначе на 120 Гц
   * кораблей рождалось бы вдвое больше, чем на 60, и трафик зависел бы от частоты
   * кадров — как когда-то зависела вся вероятностная механика.
   *
   * Проверяется НИЖЕ потолка: упёршись в MAX, оба мира сравнялись бы сами,
   * и восьмикратная разница в частоте осталась бы незамеченной.
   */
  it('число встреченных не зависит от частоты кадров', () => {
    const slow = quiet()
    const fast = quiet()

    const seconds = TRAFFIC.FIRST_DELAY + TRAFFIC.INTERVAL * 1.5
    run(slow, seconds, 1 / 30)
    run(fast, seconds, 1 / 240)

    expect(met(slow).length).toBe(met(fast).length)
  })

  it('больше положенного в системе не летает', () => {
    const world = quiet()
    run(world, TRAFFIC.INTERVAL * (TRAFFIC.MAX + 10))
    expect(met(world).length).toBeLessThanOrEqual(TRAFFIC.MAX)
  })

  /**
   * Пустой космос — тоже событие. Если бы каждая попытка приводила корабль,
   * встречи шли бы по метроному и перестали что-либо значить.
   */
  it('не всякая попытка кончается встречей', () => {
    const world = quiet()
    let attempts = 0
    let arrivals = 0

    for (let i = 0; i < 40; i++) {
      // Дотягиваем таймер до нуля мгновенно и считаем, чем кончилась попытка.
      world.trafficTimer = 0
      const born = stepTraffic(world, 1 / 60)
      attempts++
      if (born.length > 0) arrivals++
      // Освобождаем место: потолок не должен подменять собой вероятность.
      world.ships = []
    }

    expect(arrivals).toBeGreaterThan(0)
    expect(arrivals).toBeLessThan(attempts)
  })

  /** Не всегда пираты. За долгий прогон приходят и мирные, и враждебные. */
  it('встречаются и мирные, и враждебные', () => {
    const world = quiet()
    const factions = new Set<string>()

    for (let i = 0; i < 200; i++) {
      world.trafficTimer = 0
      for (const ship of stepTraffic(world, 1 / 60)) factions.add(ship.faction)
      world.ships = []
    }

    expect(factions.has('neutral')).toBe(true)
    expect(factions.has('hostile')).toBe(true)
  })

  /** Иногда приходят пачкой: стая пиратов и караван — это одна встреча, а не три. */
  it('встреча бывает групповой', () => {
    const world = quiet()
    let biggest = 0

    for (let i = 0; i < 200; i++) {
      world.trafficTimer = 0
      biggest = Math.max(biggest, stepTraffic(world, 1 / 60).length)
      world.ships = []
    }

    expect(biggest).toBeGreaterThan(1)
  })

  /**
   * Дистанция появления. Ближе — корабль возникает из ничего на глазах; дальше —
   * он не попадает даже на локатор, и встречи не выходит.
   */
  it('приходят с дистанции, на которой их уже видно локатором', () => {
    const world = deepSpace()

    for (let i = 0; i < 40; i++) {
      world.trafficTimer = 0
      for (const ship of stepTraffic(world, 1 / 60)) {
        const distance = ship.state.pos.distanceTo(world.player.state.pos)
        // Группа расходится на GROUP_SPREAD от общего центра.
        expect(distance).toBeGreaterThan(TRAFFIC.SPAWN_MIN - TRAFFIC.GROUP_SPREAD)
        expect(distance).toBeLessThan(TRAFFIC.SPAWN_MAX + TRAFFIC.GROUP_SPREAD)
      }
      world.ships = []
    }
  })

  /**
   * Маршруты сходятся у планет: там причал, там рынок, там и пират, который этим
   * кормится. Проверяется ОТНОШЕНИЕ, а не число: `QUIET_RANGE` и `CHANCE` будут
   * крутить, и тест не должен падать от каждой правки баланса.
   *
   * В пустоте встречи не запрещены — они редки. Ноль здесь был бы враньём:
   * одинокий скиталец между мирами возможен.
   */
  it('вдали от миров встречи реже', () => {
    const born = (world: World): number => {
      let count = 0
      for (let i = 0; i < 400; i++) {
        world.trafficTimer = 0
        count += stepTraffic(world, 1 / 60).length
        world.ships = [] // потолок одновременных не должен мешать счёту
      }
      return count
    }

    const near = born(quiet())

    const far = quiet()
    // Далеко от всего: и от планет, и от причала. Звезда не в счёт — у неё не живут.
    far.player.state.pos.set(0, 3e9, 0)
    const void_ = born(far)

    expect(near).toBeGreaterThan(0)
    expect(void_).toBeLessThan(near / 4)
  })

  /**
   * Улетевший за горизонт убирается — ЛЮБОЙ фракции. Пират, потерявший игрока,
   * не вернётся никогда: он просто копился бы в списке.
   */
  it('ушедший далеко исчезает, кем бы он ни был', () => {
    const world = quiet()
    run(world, TRAFFIC.FIRST_DELAY + TRAFFIC.INTERVAL * 2)
    const ship = met(world)[0]
    expect(ship).toBeDefined()
    if (!ship) return

    for (const s of met(world)) s.state.pos.copy(world.player.state.pos).setX(TRAFFIC.DESPAWN_RANGE + 100)
    stepTraffic(world, 1 / 60)
    expect(met(world)).toHaveLength(0)
  })

  /**
   * Захваченная цель не растворяется в рамке прицела: пилот на неё смотрит,
   * и исчезновение читается как поломка, а не как уход за пределы радара.
   */
  it('захваченный не исчезает, даже улетев далеко', () => {
    const world = quiet()
    run(world, TRAFFIC.FIRST_DELAY + TRAFFIC.INTERVAL * 2)
    const ship = met(world)[0]
    expect(ship).toBeDefined()
    if (!ship) return

    world.lockedTargetId = ship.id
    ship.state.pos.copy(world.player.state.pos).setX(TRAFFIC.DESPAWN_RANGE * 3)
    stepTraffic(world, 1 / 60)
    expect(met(world).some((s) => s.id === ship.id)).toBe(true)
  })

  /** Нейтрал не воюет и не является добычей — это свойство фракции, а не трафика. */
  it('торговец не враждебен никому и никому не враг', () => {
    expect(isHostileTo('neutral', 'hostile')).toBe(false)
    expect(isHostileTo('hostile', 'neutral')).toBe(false)
    expect(isHostileTo('neutral', 'player')).toBe(false)
  })

  it('корабль рождается с пилотом и с курсом на своё назначение', () => {
    const world = quiet()
    run(world, TRAFFIC.FIRST_DELAY + TRAFFIC.INTERVAL * 2)
    const ship = met(world)[0]
    expect(ship).toBeDefined()
    if (!ship) return

    expect(ship.ai).not.toBeNull()
    expect(ship.controls.throttle).toBeGreaterThan(0)
    // Дом — это НАЗНАЧЕНИЕ, а не место рождения: иначе он закружит там, где возник.
    expect(ship.ai!.home.distanceTo(ship.state.pos)).toBeGreaterThan(1000)
  })

  /** Одно зерно — один трафик. Иначе ни сохранений, ни сети. */
  it('трафик детерминирован', () => {
    const a = quiet()
    const b = quiet()
    run(a, TRAFFIC.INTERVAL * 3)
    run(b, TRAFFIC.INTERVAL * 3)

    expect(met(a).map((s) => s.state.pos.toArray())).toEqual(met(b).map((s) => s.state.pos.toArray()))
  })
})
