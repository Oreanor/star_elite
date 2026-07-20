import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { DOCKING, SHIELD } from '../../config/station'
import { ARMOUR_COMPOSITE, SHIELD_HEAVY } from '../../config/modules'
import { addCommodity, cargoMass } from '../cargo/hold'
import { COMMODITIES } from '../cargo/items'
import { applyDamage } from '../combat'
import { stepWorld, type Controller, type ControllerMap } from '../sim'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import { stepOrbits } from '../world/orbits'
import { autodockController, canEngageAutodock } from './autopilot'
import { canDockAt, dock, dockThreshold, findStation, stationRange, undock } from './docking'
import { buy, buyCommodity, canBuyCommodity, commodityBuyPrice, commoditySellPrice, masterClass, repair, repairChance, repairCost, sellItem } from './shop'

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
   * Врезаться в станцию нельзя, и «подлетел вручную — пристыковался» больше НЕ работает:
   * шаг мира не стыкует по касанию. У поверхности стоит защитное поле, оно отпружинивает
   * корабль без допуска. Стыковка теперь — только автопилотом по L (см. тест ниже).
   */
  it('шаг мира не стыкует по касанию — врезаться в станцию нельзя', () => {
    const world = quiet()
    atDock(world)
    expect(world.docked).toBe(false)

    stepWorld(world, 1 / 60, new Map())
    expect(world.docked).toBe(false)
  })

  /** Разогнавшийся не таранит станцию, а отпружинивает от поля, ТЕРЯЯ скорость. */
  it('поле отбрасывает разогнавшийся корабль назад и гасит ход', () => {
    const world = quiet()
    const station = findStation(world)!
    const shieldR = station.radius * SHIELD.RADIUS_FACTOR

    // Летим прямо в станцию на скорости — влетаем в поле снаружи, вплотную к нему.
    world.player.state.pos.copy(station.pos).add(new Vector3(0, 0, shieldR + 8))
    const speed = DOCKING.MAX_SPEED + 120
    world.player.state.vel.set(0, 0, -speed)
    world.player.clearance = false

    // Несколько кадров: долетел до поля и отпружинил (vel.z сменил знак).
    for (let i = 0; i < 30 && world.player.state.vel.z <= 0; i++) stepWorld(world, 1 / 60, new Map())

    expect(world.docked).toBe(false)
    // Отпружинил: скорость вдоль оси станции сменила знак (летит уже прочь).
    expect(world.player.state.vel.z).toBeGreaterThan(0)
    // И потерял ход — отскок медленнее налёта (восстановление < 1).
    expect(world.player.state.vel.length()).toBeLessThan(speed)
    // Вспышка поля родилась.
    expect(world.shieldFlashes.length).toBeGreaterThan(0)
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

  it('после долгой стоянки выпускает у текущей позиции станции, а не в старой точке', () => {
    const world = quiet()
    const station = findStation(world)!
    atDock(world)
    dock(world)

    world.calendarTime += 12_345
    undock(world)
    // Повторная раскладка на тот же момент ничего не должна менять. Без обновления
    // внутри undock станция прыгнет сюда только сейчас, оставив корабль далеко.
    stepOrbits(world)

    expect(stationRange(world.player, station)).toBeCloseTo(DOCKING.RELEASE_GAP, 0)
  })

  it('станция не убегает после вылета на ускоренной календарной орбите', () => {
    const world = quiet()
    const station = findStation(world)!
    atDock(world)
    dock(world)
    undock(world)
    world.player.state.vel.set(0, 0, 0)
    world.player.controls.throttle = 0
    world.player.controls.flightAssist = false

    for (let i = 0; i < 5 * 60; i++) {
      world.calendarTime += 1 / 60
      stepWorld(world, 1 / 60, new Map())
    }

    expect(stationRange(world.player, station)).toBeLessThan(1_000)
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

  /** Но выйдя за зону, взвод возвращается: стыковка снова возможна, а не билет в один конец. */
  it('покинувший зону снова может стыковаться (взвод возвращается)', () => {
    const world = quiet()
    atDock(world)
    dock(world)
    undock(world)
    // Отчалил — взвод сброшен: у кольца сразу обратно не пристыкуешься.
    expect(world.dockArmed).toBe(false)

    // Улетел на пару километров и погасил ход — взвод возвращается сам.
    const station = findStation(world)!
    world.player.state.pos.copy(station.pos).add(new Vector3(0, 0, station.radius + 2_000))
    world.player.state.vel.set(0, 0, 0)
    stepWorld(world, 1 / 60, new Map())
    expect(world.dockArmed).toBe(true)

    // И стыковка снова проходит командой (тот же путь, что зовёт автопилот по L).
    atDock(world)
    expect(dock(world)).toBe(true)
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
    // Порог берём ФОРМУЛОЙ, а не константой: зона стыковки растёт с радиусом причала
    // (0.3·R, но не тоньше DOCKING.RANGE), иначе тест ломается от смены габарита станции.
    expect(stationRange(world.player, station)).toBeLessThan(dockThreshold(station))
  })
})

describe('магазин', () => {
  // Ремонт корпуса — БРОСОК у мастерской (класс от развития планеты). Исход зависит от
  // системы, поэтому проверяем ИНВАРИАНТ по каждому исходу, а не конкретный успех:
  // успех — корпус в норму и деньги списаны; провал — денег не берут, корпус не лучше;
  // не берутся — ничего не изменилось. Щит за деньги не чинят никогда.
  it('ремонт корпуса: успех чинит и списывает, провал не берёт денег, отказ ничего не трогает', () => {
    const world = quiet()
    const player = world.player
    applyDamage(player, player.spec.hull.shield + 40, 0)
    expect(repairCost(player)).toBeGreaterThan(0)

    const creditsBefore = world.credits
    const hullBefore = player.hull
    const out = repair(world, player)
    if (out === 'repaired') {
      expect(player.hull).toBe(player.spec.hull.hull)
      expect(world.credits).toBeLessThan(creditsBefore)
      expect(player.shield).toBe(0)
    } else if (out === 'botched') {
      expect(player.hull).toBeLessThanOrEqual(hullBefore) // доломали или без изменений
      expect(world.credits).toBe(creditsBefore) // за провал денег не берут
    } else {
      expect(out).toBe('refused') // местная мастерская не тянет класс корпуса
      expect(player.hull).toBe(hullBefore)
      expect(world.credits).toBe(creditsBefore)
    }
  })

  it('нет денег — ремонт не списывает и корпус не чинит', () => {
    const world = quiet()
    applyDamage(world.player, world.player.spec.hull.shield + 40, 0)
    world.credits = 0
    const out = repair(world, world.player)
    // Либо не хватило денег, либо тут вообще не берутся — но платы нет и корпус не в норме.
    expect(['no-money', 'refused']).toContain(out)
    expect(world.credits).toBe(0)
    expect(world.player.hull).toBeLessThan(world.player.spec.hull.hull)
  })

  // Таблица шансов мастерской — прямой инвариант задумки, без случайности.
  it('мастерская: класс от развития и шанс ремонта по классу вещи', () => {
    // Класс мастерской растёт с тех-уровнем поселения (пороги те же, что у сервиса).
    expect(masterClass({ techLevel: 2 } as never)).toBe(1)
    expect(masterClass({ techLevel: 6 } as never)).toBe(2)
    expect(masterClass({ techLevel: 12 } as never)).toBe(3)
    // Мастер 1 не берётся за класс-3 (разрыв в два), но уверенно чинит свой класс.
    expect(repairChance(1, 3, 1)).toBe(0)
    expect(repairChance(1, 1, 0)).toBeCloseTo(0.7)
    expect(repairChance(1, 1, 1)).toBeCloseTo(1)
    // Мастер 3 при зашкале развития чинит класс-3 наверняка; класс ниже — всегда.
    expect(repairChance(3, 3, 1)).toBeCloseTo(1)
    expect(repairChance(3, 1, 0)).toBe(1)
    // Тянется на класс выше — берётся, но с риском (не ноль и не единица).
    expect(repairChance(2, 3, 0.5)).toBeGreaterThan(0)
    expect(repairChance(2, 3, 0.5)).toBeLessThan(1)
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
   * иначе. Количество берём ФАКТИЧЕСКОЕ: трюм стартового «Авроры» мал, и подгонять
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
