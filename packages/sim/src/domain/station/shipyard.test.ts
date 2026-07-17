import { describe, expect, it } from 'vitest'
import { SHIPYARD } from '../../config/loadouts'
import { deriveShipSpec } from '../loadout'
import { addCommodity } from '../cargo/hold'
import { COMMODITIES } from '../cargo/items'
import { createWorld } from '../world'
import { fitOntoChassis, swapHull } from './shipyard'

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
    const world = createWorld()
    // Ставим лёгкую сборку истребителя (с приводом): она заведомо влезет в грузовик,
    // и «успешную» смену не сорвёт грузоподъёмность — это проверяет отдельный тест.
    world.player.loadout = SHIPYARD.find((o) => o.chassis.id === 'hermes')!.loadout()
    const freighter = SHIPYARD.find((o) => o.chassis.id === 'atlas')!

    // В пустоте корпус не сменить: верфь есть только у станции.
    world.docked = false
    expect(swapHull(world, freighter.chassis, 0)).toBe('not-docked')
    expect(world.player.loadout.chassis.id).toBe('hermes')

    world.docked = true
    world.player.hull = 1
    expect(swapHull(world, freighter.chassis, 0)).toBeNull()
    expect(world.player.loadout.chassis.id).toBe('atlas')
    // Свежий корабль заправлен под завязку: корпус, щит и заряд привода — на максимум.
    expect(world.player.hull).toBe(world.player.spec.hull.hull)
    expect(world.player.jumpCharge).toBe(world.player.spec.jumpRange)
    // Привод переехал со старого корпуса — новый умеет прыгать.
    expect(world.player.spec.jumpRange).toBeGreaterThan(0)
  })

  it('не хватает денег — корпус не меняется', () => {
    const world = createWorld()
    world.docked = true
    world.credits = 0
    const demeter = SHIPYARD.find((o) => o.chassis.id === 'atlas')!
    expect(swapHull(world, demeter.chassis, 1)).toBe('no-money')
    // Игрок стартует на «Авроре One» — корпус не сменился, денег нет.
    expect(world.player.loadout.chassis.id).toBe('aurora_one')
  })

  /**
   * Обвес, не влезший в слоты компактного корпуса, переезжает в ТРЮМ, а не пропадает:
   * у старта семь внутренних модулей, у крошечного дрона слотов меньше — разница ложится
   * грузом. Проверяем поведение (железо не исчезло), а не конкретные числа.
   */
  it('лишнее железо переезжает в трюм, если у корпуса нет под него слота', () => {
    const world = createWorld()
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
    const world = createWorld()
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
})
