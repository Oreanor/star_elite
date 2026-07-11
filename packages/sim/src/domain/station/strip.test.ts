import { describe, expect, it } from 'vitest'
import { createWorld } from '../world'
import { isArmour, isEssential } from '../loadout'
import { moduleResaleValue, sellModule, unfitModule } from './shop'

/**
 * Снятие и продажа установленного железа. Проверяем ИНВАРИАНТЫ операции, а не
 * магические суммы: модуль покидает корабль, трюм/кредиты меняются на верную сторону,
 * а выкупная цена реагирует на прокачку и повреждение по СМЫСЛУ, не по константе.
 */
describe('снятие и продажа модуля', () => {
  it('снять — модуль уходит в трюм, слот освобождается', () => {
    const ship = createWorld().player
    const cargo = ship.loadout.internals.find((m) => m.kind === 'cargo')!
    const internalsBefore = ship.loadout.internals.length

    expect(unfitModule(ship, cargo)).toBeNull()
    expect(ship.loadout.internals.includes(cargo)).toBe(false)
    expect(ship.loadout.internals.length).toBe(internalsBefore - 1)
    expect(ship.hold.items.some((i) => i.kind === 'module' && i.module === cargo)).toBe(true)
  })

  it('продать — модуль исчезает, кредиты растут ровно на выкупную цену', () => {
    const world = createWorld()
    const ship = world.player
    const cargo = ship.loadout.internals.find((m) => m.kind === 'cargo')!
    const value = moduleResaleValue(ship, cargo)
    const before = world.credits

    expect(sellModule(world, ship, cargo)).toBeNull()
    expect(world.credits).toBe(before + value)
    expect(ship.loadout.internals.includes(cargo)).toBe(false)
    // Проданное — сразу в деньги, а не в трюм: места не занимает.
    expect(ship.hold.items.some((i) => i.kind === 'module' && i.module === cargo)).toBe(false)
  })

  it('выкуп дешевле покупки, прокачка его поднимает', () => {
    const ship = createWorld().player
    const cargo = ship.loadout.internals.find((m) => m.kind === 'cargo')!
    // Продают ниже цены каталога — иначе перепродажа была бы вечным двигателем.
    expect(moduleResaleValue(ship, cargo)).toBeLessThan(cargo.cost)
    // За прокачку платили — прокачанный ценнее стокового того же вида.
    expect(moduleResaleValue(ship, { ...cargo, upgrade: 0.5 })).toBeGreaterThan(moduleResaleValue(ship, cargo))
  })

  it('битая броня стоит меньше целой: повреждение сбивает выкуп', () => {
    const ship = createWorld().player
    const armour = ship.loadout.internals.find(isArmour)!
    const whole = moduleResaleValue(ship, armour)
    ship.hull = ship.spec.hull.hull / 2 // половина корпуса выбита
    expect(moduleResaleValue(ship, armour)).toBeLessThan(whole)
  })

  it('двигатель и маневровые снять и продать нельзя — без них не летишь', () => {
    // Регрессия: снятие в пустоту оставило бы корабль недвижимым на верфи. Их только
    // заменяют (buy/fitFromHold сами вытесняют старый), а «снять»/«продать» — отказ.
    const world = createWorld()
    const ship = world.player
    for (const essential of ship.loadout.internals.filter(isEssential)) {
      expect(unfitModule(ship, essential)).toBe('essential')
      expect(sellModule(world, ship, essential)).toBe('essential')
      // Отказ — не молчаливая порча: модуль на месте, слот цел.
      expect(ship.loadout.internals.includes(essential)).toBe(true)
    }
  })
})
