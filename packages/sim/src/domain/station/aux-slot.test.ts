import { describe, expect, it } from 'vitest'
import { veteranWorld } from '../../testkit'
import { CHASSIS_CATALOGUE } from '../../config/chassis'
import { ECM_UNIT, MIELOPHONE_DEVICE, MODULE_CATALOGUE } from '../../config/modules'
import { slotCategoryOf } from '../loadout'
import { addItem } from '../cargo/hold'
import { buy, canFit, fitFromHold, priceOf } from './shop'

/**
 * Аукс — ОДИН слот на все его виды (маскировка, РЭБ, миелофон…). Покупка считала занятость
 * по виду и ставила РЭБ рядом с маскировкой: второй модуль в единственном слоте.
 */
describe('общий аукс-слот', () => {
  const auxCount = (w: ReturnType<typeof veteranWorld>) =>
    w.player.loadout.internals.filter((m) => slotCategoryOf(m.kind) === 'aux').length
  const auxSlots = (w: ReturnType<typeof veteranWorld>) =>
    w.player.loadout.chassis.slots.filter((s) => s.kind === 'aux').length

  it('покупка другого аукс-вида вытесняет стоящий, а не встаёт рядом', () => {
    const world = veteranWorld()
    expect(auxCount(world)).toBe(auxSlots(world)) // слот уже занят маскировкой
    world.credits = priceOf(ECM_UNIT) * 2

    expect(buy(world, world.player, ECM_UNIT)).toBeNull()
    expect(auxCount(world)).toBe(auxSlots(world))
    expect(world.player.loadout.internals.some((m) => m.id === ECM_UNIT.id)).toBe(true)
  })

  // Дар Слова получает и тот, кто летает на стартовой «Нике» (класс 2). Миелофон был класса 3
  // и не вставал никуда, кроме крупных корпусов: подарок требовал сперва пересесть.
  it('миелофон из трюма встаёт в аукс на ЛЮБОМ корпусе с аукс-слотом', () => {
    for (const chassis of CHASSIS_CATALOGUE.filter((c) => c.slots.some((s) => s.kind === 'aux'))) {
      const world = veteranWorld()
      const p = world.player
      p.loadout.chassis = chassis
      p.loadout.internals = p.loadout.internals.filter((m) => slotCategoryOf(m.kind) !== 'aux')
      addItem(p.hold, { kind: 'module', module: MIELOPHONE_DEVICE })

      expect(fitFromHold(p, p.hold.items.length - 1), chassis.name).toBeNull()
      expect(p.loadout.internals.some((m) => m.kind === 'mielophone')).toBe(true)
    }
  })

  it('на корпус ниже класса модуля установка отказывает явной причиной', () => {
    const world = veteranWorld()
    const p = world.player
    const small = CHASSIS_CATALOGUE.reduce((a, b) => (b.class < a.class ? b : a))
    const big = MODULE_CATALOGUE.find((m) => slotCategoryOf(m.kind) === 'aux' && m.class > small.class)
    expect(big).toBeDefined()
    p.loadout.chassis = small
    expect(canFit(p, big!)).toBe('class-too-large')
  })
})
