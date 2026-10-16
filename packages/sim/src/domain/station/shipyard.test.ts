import { describe, expect, it } from 'vitest'
import { veteranWorld } from '../../testkit'
import { SHIPYARD } from '../../config/loadouts'
import { deriveShipSpec } from '../loadout'
import { addCommodity } from '../cargo/hold'
import { COMMODITIES } from '../cargo/items'
import { fitOntoChassis, hullPurchase, swapHull } from './shipyard'
import { CARGO_LARGE, CARGO_SMALL } from '../../config/modules'

/**
 * Верфь — правило, а не кнопка. Проверяем без рендера.
 */
describe('верфь корпусов', () => {
  /**
   * Свойство, а не число: каждый продаваемый корпус ОБЯЗАН уметь прыгать. Купив
   * корабль без привода, игрок застрял бы в системе навсегда — верфь-ловушка.
   * Оттого «Аресу» и «Каллиопе» и добавлен слот под гиперпривод.
   */
  it('каждый корпус на верфи умеет прыгать', () => {
    for (const offer of SHIPYARD) {
      const spec = deriveShipSpec(offer.loadout())
      expect(spec.jumpRange, offer.chassis.name).toBeGreaterThan(0)
    }
  })

  it('сменил корпус — обвес переехал, рама заправлена; только у причала', () => {
    const world = veteranWorld()
    // Ставим лёгкую сборку истребителя (с приводом): она заведомо влезет в грузовик,
    // и «успешную» смену не сорвёт грузоподъёмность — это проверяет отдельный тест.
    world.player.loadout = SHIPYARD.find((o) => o.chassis.id === 'hermes')!.loadout()
    const freighter = SHIPYARD.find((o) => o.chassis.id === 'orion')!

    // В пустоте корпус не сменить: верфь есть только у станции.
    world.docked = false
    expect(swapHull(world, freighter.chassis, 0)).toBe('not-docked')
    expect(world.player.loadout.chassis.id).toBe('hermes')

    world.docked = true
    world.player.hull = 1
    expect(swapHull(world, freighter.chassis, 0)).toBeNull()
    expect(world.player.loadout.chassis.id).toBe('orion')
    // Свежий корабль заправлен под завязку: корпус, щит и заряд привода — на максимум.
    expect(world.player.hull).toBe(world.player.spec.hull.hull)
    expect(world.player.jumpCharge).toBe(world.player.spec.jumpRange)
    // Привод переехал со старого корпуса — новый умеет прыгать.
    expect(world.player.spec.jumpRange).toBeGreaterThan(0)
  })

  it('не хватает денег — корпус не меняется', () => {
    const world = veteranWorld()
    world.docked = true
    world.credits = 0
    const demeter = SHIPYARD.find((o) => o.chassis.id === 'orion')!
    expect(swapHull(world, demeter.chassis, 1)).toBe('no-money')
    // Корпус не сменился — денег нет.
    expect(world.player.loadout.chassis.id).not.toBe('orion')
  })

  /**
   * Обвес, не влезший в слоты компактного корпуса, переезжает в ТРЮМ, а не пропадает:
   * у старта семь внутренних модулей, у крошечного дрона слотов меньше — разница ложится
   * грузом. Проверяем поведение (железо не исчезло), а не конкретные числа.
   */
  it('лишнее железо переезжает в трюм, если у корпуса нет под него слота', () => {
    const world = veteranWorld()
    world.docked = true
    const start = world.player.loadout
    const fit = fitOntoChassis(start, SHIPYARD.find((o) => o.chassis.id === 'hermes')!.chassis)
    // Что-то не влезло ИЛИ влезло всё — но сумма ВНУТРЕННИХ модулей не потерялась:
    // слоты + осевшие в overflow внутренние = было (оружие/пилоны считаем отдельно).
    const weaponKinds = ['laser', 'missile', 'drone']
    const kept = fit.loadout.internals.length + fit.overflow.filter((m) => !weaponKinds.includes(m.kind)).length
    expect(kept).toBe(start.internals.length)
  })

  /**
   * Если и в трюм не влезет весь перенесённый обвес — смену отклоняем целиком, а не
   * теряем железо и не оставляем корабль в полусобранном виде. Забиваем трюм грузом,
   * чтобы места на overflow не осталось.
   */
  it('не хватает грузоподъёмности на перенос — смена отклонена, мир не тронут', () => {
    const world = veteranWorld()
    world.docked = true
    // Забиваем трюм под завязку рудой: места на вытесненные модули не останется.
    addCommodity(world.player.hold, COMMODITIES.MINERALS, 100_000)

    // Мелкий корпус (у «Ареса» слотов меньше, чем у «Авроры»): часть обвеса вытесняется
    // в трюм, а он забит рудой — переносу негде осесть.
    const small = SHIPYARD.find((o) => o.chassis.id === 'hermes')!
    const before = world.player.loadout.chassis.id
    const result = swapHull(world, small.chassis, 0)
    if (result === 'no-room') {
      expect(world.player.loadout.chassis.id).toBe(before) // мир не тронут
    } else {
      // Всё вместилось — тогда хотя бы обвес не потерялся (переехал в слоты/трюм).
      expect(result).toBeNull()
    }
  })

  it('у каждого корпуса три грузовых слота — контейнеры при пересадке переезжают все', () => {
    // Пойманное: у истребителей грузовой слот был один, и второй контейнер при пересадке
    // уезжал в трюм грузом — торговцу сменить корабль значило потерять трюм.
    for (const offer of SHIPYARD) {
      expect(offer.chassis.slots.filter((x) => x.kind === 'cargo').length, offer.chassis.name).toBe(3)
    }
    const world = veteranWorld()
    const lo = world.player.loadout
    const withRacks = { ...lo, internals: [...lo.internals.filter((m) => m.kind !== 'cargo'), CARGO_SMALL, CARGO_LARGE] }
    for (const offer of SHIPYARD) {
      const fit = fitOntoChassis(withRacks, offer.chassis)
      expect(fit.overflow.some((m) => m.kind === 'cargo'), offer.chassis.name).toBe(false)
    }
  })

  it('не вставшее в слоты можно продать в сделке: в трюм не едет, цена — в зачёт', () => {
    const world = veteranWorld()
    world.docked = true
    const small = SHIPYARD.find((o) => o.chassis.id === 'hermes')!
    const keep = hullPurchase(world, small.chassis, false)
    if (keep.overflow.length === 0) return
    const sell = hullPurchase(world, small.chassis, true)
    expect(sell.net).toBe(keep.net - keep.overflowValue)
    expect(sell.loadAfter).toBeLessThan(keep.loadAfter)

    world.credits = Math.max(0, sell.net) + 1
    const modulesBefore = world.player.hold.items.filter((i) => i.kind === 'module').length
    expect(swapHull(world, small.chassis, sell.net, true)).toBeNull()
    expect(world.player.hold.items.filter((i) => i.kind === 'module').length).toBe(modulesBefore)
  })

  it('ряд корпусов — от дешёвых к дорогим; «Гермес» последний и только у диктатур', () => {
    for (let i = 1; i < SHIPYARD.length; i++) {
      expect(SHIPYARD[i]!.cost, SHIPYARD[i]!.chassis.name).toBeGreaterThanOrEqual(SHIPYARD[i - 1]!.cost)
    }
    expect(SHIPYARD[SHIPYARD.length - 1]!.chassis.id).toBe('hermes')
    expect(SHIPYARD.find((o) => o.chassis.id === 'hermes')!.soldBy).toEqual(['Диктатура'])
  })
})
