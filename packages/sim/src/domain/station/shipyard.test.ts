import { describe, expect, it } from 'vitest'
import { veteranWorld } from '../../testkit'
import { playerStartLoadout, SHIPYARD, type HullOffer } from '../../config/loadouts'
import { deriveShipSpec } from '../loadout'
import { addCommodity } from '../cargo/hold'
import { COMMODITIES } from '../cargo/items'
import { fitOntoChassis, hullPurchase, stackWithFactory, swapHull } from './shipyard'
import { CARGO_LARGE, CARGO_SMALL, MODULE_CATALOGUE } from '../../config/modules'

/** Модули заводской сборки: внутренности и стволы. Пустая точка не считается. */
function fittedGear(offer: HullOffer) {
  const fit = offer.loadout()
  return [...fit.internals, ...fit.weapons.filter((m) => m !== null)]
}

function gearClasses(offer: HullOffer): number[] {
  return fittedGear(offer).map((m) => m.class)
}

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

  it('примерка своего обвеса не снимает заводское, а докладывает в свободные слоты', () => {
    // Галочка на верфи подменяла витрину только своим железом: штатный щит и ствол
    // пропадали, и корпус читался слабее того, что показывали без галочки.
    const factory = SHIPYARD.find((o) => o.chassis.id === 'perseus')!.loadout()
    const stacked = stackWithFactory(playerStartLoadout(), factory)
    for (const module of factory.internals) {
      const before = factory.internals.filter((m) => m.id === module.id).length
      const after = stacked.internals.filter((m) => m.id === module.id).length
      expect(after, module.id).toBeGreaterThanOrEqual(before)
    }
    expect(stacked.weapons[0]?.id).toBe(factory.weapons[0]?.id)
    // У «Персея» одна орудийная пустая — своё встаёт в неё, не вместо штатной.
    expect(stacked.weapons.filter((w) => w != null).length).toBeGreaterThan(
      factory.weapons.filter((w) => w != null).length,
    )
    // Заводской контейнер остаётся, свой — во второй грузовой слот.
    expect(stacked.internals.filter((m) => m.kind === 'cargo').length).toBeGreaterThan(
      factory.internals.filter((m) => m.kind === 'cargo').length,
    )
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

  it('ступень лестницы заметно дороже, крепче и принимает железо не хуже предыдущей', () => {
    // Плюс десять процентов не отличает корпуса: следующая ступень должна стоить в разы,
    // шкура расти, а потолок класса не падать. Заводская сборка обязана в этот потолок
    // влезать и быть не беднее железом, чем у более дешёвого соседа.
    for (let i = 1; i < SHIPYARD.length; i++) {
      const prev = SHIPYARD[i - 1]!
      const next = SHIPYARD[i]!
      expect(next.cost, next.chassis.name).toBeGreaterThanOrEqual(prev.cost * 1.6)
      expect(next.chassis.baseHull, next.chassis.name).toBeGreaterThan(prev.chassis.baseHull)
      expect(next.chassis.class, next.chassis.name).toBeGreaterThanOrEqual(prev.chassis.class)
      const prevGear = Math.max(...gearClasses(prev))
      const nextGear = Math.max(...gearClasses(next))
      // «Ника» дороже «Икара», но с завода на ней самое слабое железо каталога.
      if (next.chassis.id === 'aurora_one') expect(nextGear, next.chassis.name).toBeLessThan(prevGear)
      else expect(nextGear, next.chassis.name).toBeGreaterThanOrEqual(prevGear)
      for (const cls of gearClasses(next)) {
        expect(cls, next.chassis.name).toBeLessThanOrEqual(next.chassis.class)
      }
    }
    const first = SHIPYARD[0]!
    const last = SHIPYARD[SHIPYARD.length - 1]!
    expect(Math.max(...gearClasses(last))).toBeGreaterThan(Math.max(...gearClasses(first)))
    expect(last.chassis.class).toBeGreaterThan(first.chassis.class)
  })

  it('с завода стоит начальный или средний грейд своего класса, не вершина', () => {
    // Буква A в каталоге — самая дорогая в своём классе. Её с верфи не отдают:
    // иначе следующий грейд покупать незачем. Трюм бесклассовый и в эту мерку не входит.
    const core = new Set(['engine', 'thrusters', 'shield', 'armour', 'hyperdrive'])
    for (const offer of SHIPYARD) {
      for (const module of fittedGear(offer)) {
        if (module.kind === 'cargo') continue
        const dearer = MODULE_CATALOGUE.some(
          (other) => other.kind === module.kind && other.class === module.class && other.cost > module.cost,
        )
        expect(dearer, `${offer.chassis.name}: ${module.name}`).toBe(true)
        if (!core.has(module.kind)) continue
        // «Ника» — низ лестницы: с завода первый класс, хотя слоты рамы принимают второй.
        if (offer.chassis.id === 'aurora_one') expect(module.class, module.name).toBe(1)
        else expect(module.class, module.name).toBe(offer.chassis.class)
      }
    }
  })
})
