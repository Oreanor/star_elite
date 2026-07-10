import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { DOCKING } from '../../config/station'
import { ARMOUR_COMPOSITE, SHIELD_HEAVY } from '../../config/modules'
import { addCommodity, cargoMass } from '../cargo/hold'
import { COMMODITIES } from '../cargo/items'
import { applyDamage } from '../combat'
import { stepWorld, type Controller, type ControllerMap } from '../sim'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { autodockController, canEngageAutodock } from './autopilot'
import { canDockAt, dock, findStation, stationRange, undock } from './docking'
import { buy, buyCommodity, canBuyCommodity, commodityBuyPrice, commoditySellPrice, repair, repairCost, sellItem } from './shop'

function quiet(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

/** Ставит игрока в метре от причального кольца и гасит скорость. */
function atDock(world: World): void {
  const station = findStation(world)!
  world.player.state.pos.copy(station.pos).add(new Vector3(0, 0, station.radius + 1))
  world.player.state.vel.set(0, 0, 0)
}

describe('стыковка', () => {
  it('в стартовой системе игрок начинает рядом со станцией', () => {
    const world = quiet()
    const station = findStation(world)!
    // Инвариант, а не число: игра начинается в зоне действия автопилота.
    expect(canEngageAutodock(world)).toBe(true)
    expect(stationRange(world.player, station)).toBeGreaterThan(DOCKING.RANGE)
  })

  it('на скорости стыковаться нельзя, как бы близко ты ни был', () => {
    const world = quiet()
    const station = findStation(world)!
    atDock(world)
    expect(canDockAt(world.player, station)).toBe(true)

    world.player.state.vel.set(0, 0, DOCKING.MAX_SPEED + 1)
    expect(canDockAt(world.player, station)).toBe(false)
    expect(dock(world)).toBe(false)
  })

  /**
   * Регрессия. `dock()` звал ОДИН автопилот, поэтому подлетевший вручную игрок
   * утыкался в станцию, где не происходило ничего: тела не сталкиваются, стыковка
   * не срабатывала. Это читалось как зависшая игра. Стыковка — правило мира,
   * и шаг мира обязан её замечать сам, без клавиши.
   */
  it('подлетевший вручную стыкуется сам, без автопилота', () => {
    const world = quiet()
    atDock(world)
    expect(world.docked).toBe(false)

    stepWorld(world, 1 / 60, new Map())
    expect(world.docked).toBe(true)
  })

  /** И обратное: подошёл слишком быстро — это таран, а не стыковка. */
  it('шаг мира не стыкует того, кто идёт слишком быстро', () => {
    const world = quiet()
    atDock(world)
    world.player.state.vel.set(0, 0, DOCKING.MAX_SPEED + 1)

    stepWorld(world, 1 / 60, new Map())
    expect(world.docked).toBe(false)
  })

  /** Регрессия: мир в доке обязан стоять, иначе пираты добьют тебя через витрину. */
  it('в доке мир не шагает', () => {
    const world = quiet()
    atDock(world)
    expect(dock(world)).toBe(true)

    const before = world.time
    stepWorld(world, 1 / 60, new Map())
    expect(world.time).toBe(before)
  })

  it('отчаливание выносит корабль наружу и даёт ход от станции', () => {
    const world = quiet()
    const station = findStation(world)!
    atDock(world)
    dock(world)
    undock(world)

    expect(world.docked).toBe(false)
    expect(stationRange(world.player, station)).toBeCloseTo(DOCKING.RELEASE_GAP, 0)
    // Скорость направлена ОТ станции: иначе первый же кадр — столкновение.
    const outward = world.player.state.pos.clone().sub(station.pos).normalize()
    expect(world.player.state.vel.dot(outward)).toBeGreaterThan(0)
  })

  /**
   * Регрессия. Отчаливание выпускает корабль в `RELEASE_GAP` от кольца — это
   * ВНУТРИ `RANGE` — и на `RELEASE_SPEED` ниже `MAX_SPEED`. Шаг мира стыковал его
   * обратно в том же кадре: игрок жал «отчалить», видел один кадр космоса и снова
   * оказывался в меню. Условие входа — «пришёл снаружи», а не «оказался рядом».
   *
   * Проверяем свойство, а не числа: пока корабль не покинул зону, стыковки нет.
   */
  it('отчаливший не стыкуется обратно, пока не покинул зону причала', () => {
    const world = quiet()
    const station = findStation(world)!
    atDock(world)
    dock(world)
    undock(world)

    // Условие стыковки выполнено — и это ровно та ловушка, из-за которой был баг.
    expect(canDockAt(world.player, station)).toBe(true)

    for (let i = 0; i < 30; i++) {
      stepWorld(world, 1 / 60, new Map())
      expect(world.docked).toBe(false)
    }
  })

  /** Но выйдя за зону, корабль снова стыкуется: взвод не должен быть билетом в один конец. */
  it('покинувший зону стыкуется снова', () => {
    const world = quiet()
    atDock(world)
    dock(world)
    undock(world)

    // Улетел на пару километров и погасил ход.
    const station = findStation(world)!
    world.player.state.pos.copy(station.pos).add(new Vector3(0, 0, station.radius + 2_000))
    world.player.state.vel.set(0, 0, 0)
    stepWorld(world, 1 / 60, new Map())
    expect(world.dockArmed).toBe(true)

    atDock(world)
    stepWorld(world, 1 / 60, new Map())
    expect(world.docked).toBe(true)
  })

  /**
   * Автопилот — обычный Controller. Он не может ни разогнаться сверх паспорта,
   * ни развернуться быстрее маневровых: физика у него та же, что у игрока.
   */
  it('автопилот доводит корабль до причала и стыкует', () => {
    const world = quiet()
    const station = findStation(world)!
    const controllers: ControllerMap = new Map<number, Controller>([[world.player.id, autodockController]])

    // Полторы минуты с запасом: старт в двух километрах от кольца.
    for (let i = 0; i < 120 * 90 && !world.docked; i++) stepWorld(world, 1 / 120, controllers)

    expect(world.docked).toBe(true)
    expect(stationRange(world.player, station)).toBeLessThan(DOCKING.RANGE)
  })
})

describe('магазин', () => {
  it('ремонт стоит денег и чинит только корпус', () => {
    const world = quiet()
    const player = world.player
    applyDamage(player, player.spec.hull.shield + 40, 0)

    const cost = repairCost(player)
    expect(cost).toBeGreaterThan(0)

    const credits = world.credits
    expect(repair(world, player)).toBe(true)
    expect(player.hull).toBe(player.spec.hull.hull)
    expect(world.credits).toBe(credits - cost)
    // Щит восстанавливается сам — за него не берут.
    expect(player.shield).toBe(0)
  })

  it('нет денег — нет ремонта', () => {
    const world = quiet()
    applyDamage(world.player, world.player.spec.hull.shield + 40, 0)
    world.credits = 0
    expect(repair(world, world.player)).toBe(false)
  })

  /**
   * Главный инвариант верфи: апгрейд — это компромисс, а не улучшение по всем осям.
   * Тяжёлый щит уменьшает угловое ускорение, потому что ε = M/(m·k). Это считается,
   * а не назначается, и потому переживёт любую перебалансировку.
   */
  it('тяжёлое железо режет манёвренность', () => {
    const world = quiet()
    const player = world.player
    world.credits = 1_000_000

    const before = player.spec.tuning.PITCH_ACCEL
    expect(buy(world, player, SHIELD_HEAVY)).toBeNull()
    expect(player.spec.tuning.PITCH_ACCEL).toBeLessThan(before)

    const mid = player.spec.tuning.PITCH_ACCEL
    expect(buy(world, player, ARMOUR_COMPOSITE)).toBeNull()
    expect(player.spec.tuning.PITCH_ACCEL).toBeLessThan(mid)
  })

  /**
   * Щитовой слот один. Если бы занятый слот блокировал покупку, улучшить щит
   * было бы нельзя вообще — вся ветка прокачки оказалась бы мёртвой. Поэтому
   * апгрейд вытесняет старое железо, а станция забирает его с зачётом.
   */
  it('апгрейд вытесняет установленный модуль и возвращает часть цены', () => {
    const world = quiet()
    world.credits = 1_000_000
    const player = world.player

    const before = world.credits
    expect(buy(world, player, SHIELD_HEAVY)).toBeNull()
    expect(player.spec.hull.shield).toBe(SHIELD_HEAVY.capacity)

    // Списали цену нового, вернули часть за снятый стандартный.
    const spent = before - world.credits
    expect(spent).toBeGreaterThan(0)
    expect(spent).toBeLessThan(SHIELD_HEAVY.cost)
  })

  it('второй такой же модуль не продают и денег не списывают', () => {
    const world = quiet()
    world.credits = 1_000_000
    const player = world.player

    expect(buy(world, player, SHIELD_HEAVY)).toBeNull()
    const credits = world.credits
    expect(buy(world, player, SHIELD_HEAVY)).toBe('already-installed')
    expect(world.credits).toBe(credits)
  })
})

describe('торговля товаром', () => {
  const FOOD = COMMODITIES.FOOD

  it('купленный товар списывает деньги и ложится в трюм', () => {
    const world = quiet()
    world.credits = 10_000
    const player = world.player

    const price = commodityBuyPrice(world, FOOD)
    const bought = buyCommodity(world, player, FOOD, 3)
    expect(bought).toBe(3)
    expect(world.credits).toBe(10_000 - 3 * price)
    expect(cargoMass(player.hold)).toBeCloseTo(3 * FOOD.unitMass, 6)
  })

  /**
   * Отказать целиком там, где можно продать половину, — плохая лавка.
   * Берём столько, на сколько хватает денег и места.
   */
  it('денег хватает на часть — продают часть', () => {
    const world = quiet()
    const player = world.player
    world.credits = commodityBuyPrice(world, FOOD) * 2

    expect(buyCommodity(world, player, FOOD, 10)).toBe(2)
    expect(world.credits).toBe(0)
  })

  it('в полный трюм не грузят и денег не берут', () => {
    const world = quiet()
    world.credits = 10_000
    world.player.hold.capacity = 0

    expect(canBuyCommodity(world, world.player, FOOD)).toBe('no-room')
    expect(buyCommodity(world, world.player, FOOD, 1)).toBe(0)
    expect(world.credits).toBe(10_000)
  })

  /**
   * Главный инвариант экономики: купить и тут же продать — убыток. Прибыль обязана
   * приходить из перевозки, а не из хождения к соседнему прилавку. Проверяется
   * ОТНОШЕНИЕ цен, а не числа: переживёт любую перебалансировку наценки.
   */
  it('купить и сразу продать — всегда в минус', () => {
    const world = quiet()
    world.credits = 10_000
    const player = world.player

    const before = world.credits
    expect(buyCommodity(world, player, FOOD, 4)).toBe(4)
    const revenue = sellItem(world, player, 0)

    expect(revenue).toBeGreaterThan(0)
    expect(world.credits).toBeLessThan(before)
    expect(player.hold.items.length).toBe(0)
  })

  /**
   * Трофей достаётся даром, поэтому продаётся в чистую прибыль — но по МЕСТНОЙ
   * рыночной цене приёма, а не по каталогу: тот же груз в другой системе стоит
   * иначе. Количество берём ФАКТИЧЕСКОЕ: трюм стартового «Кобры» мал, и подгонять
   * его вместимость под тест значило бы тестировать не то.
   */
  it('трофей из трюма продаётся по рыночной цене приёма', () => {
    const world = quiet()
    const player = world.player
    const units = addCommodity(player.hold, FOOD, 5)
    expect(units).toBeGreaterThan(0)

    const sell = commoditySellPrice(world, FOOD)
    const credits = world.credits
    expect(sellItem(world, player, 0)).toBe(sell * units)
    expect(world.credits).toBe(credits + sell * units)
  })

  /** Проданный груз — минус тонны, значит плюс к ускорениям. Масса призрака недопустима. */
  it('продажа груза возвращает манёвренность', () => {
    const world = quiet()
    world.credits = 10_000
    const player = world.player

    const pitchEmpty = player.spec.tuning.PITCH_ACCEL
    buyCommodity(world, player, FOOD, 6)
    expect(player.spec.tuning.PITCH_ACCEL).toBeLessThan(pitchEmpty)

    sellItem(world, player, 0)
    expect(player.spec.tuning.PITCH_ACCEL).toBeCloseTo(pitchEmpty, 6)
  })
})
