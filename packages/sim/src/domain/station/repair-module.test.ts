import { describe, expect, it } from 'vitest'
import { findModule } from '../../config/modules'
import { isLaser, isShield } from '../loadout'
import { createWorld } from '../world'
import { moduleFault, repairModule, repairModuleQuote, withFault } from './shop'

/**
 * Ремонт ПОЛОМКИ детали у мастеров. Свойства, не числа: поломка режет характеристику
 * пропорционально, починка её возвращает, провал доламывает и денег не берёт, целую
 * деталь чинить нечего.
 */

/** Сломать установленную деталь на месте (клон-правка, как в бою): вернуть новый экземпляр. */
function breakInternal(world: ReturnType<typeof createWorld>, pick: (m: ShipModuleLike) => boolean, delta: number) {
  const idx = world.player.loadout.internals.findIndex(pick)
  const next = withFault(world.player.loadout.internals[idx]!, delta)
  world.player.loadout.internals[idx] = next
  return next
}
type ShipModuleLike = ReturnType<typeof createWorld>['player']['loadout']['internals'][number]

describe('поломка детали и её ремонт', () => {
  it('поломка на 50% срезает половину характеристики (base × (1−fault))', () => {
    const world = createWorld()
    const stockId = world.player.loadout.internals.find(isShield)!.id
    const base = findModule(stockId)!
    if (base.kind !== 'shield') throw new Error('сток щита обязан быть щитом')

    const half = breakInternal(world, isShield, 0.5)
    if (half.kind !== 'shield') throw new Error('щит остаётся щитом')
    expect(half.capacity).toBeCloseTo(base.capacity * 0.5, 5)

    // На 100% — деталь молчит совсем.
    const dead = breakInternal(world, isShield, 0.5)
    if (dead.kind !== 'shield') throw new Error('щит остаётся щитом')
    expect(dead.capacity).toBeCloseTo(0, 5)
  })

  it('целую деталь чинить нечего — «nothing», денег не трогает', () => {
    const world = createWorld()
    const laser = world.player.loadout.weapons.find((w) => w != null && isLaser(w))!
    const money = world.credits
    expect(repairModule(world, world.player, laser)).toBe('nothing')
    expect(world.credits).toBe(money)
  })

  it('quote чинит деталь по ЕЁ классу, а не по классу корпуса', () => {
    const world = createWorld()
    const laser = world.player.loadout.weapons.find((w) => w != null && isLaser(w))!
    expect(repairModuleQuote(world, laser).itemClass).toBe(laser.class)
  })

  it('исход ремонта держит инвариант: успех — в норму и платно, провал — хуже и даром', () => {
    const world = createWorld()
    world.credits = 10_000_000
    // Инвариант «успех платен» осмыслен лишь для детали С ЦЕНОЙ: ремонт даровой пушки и сам
    // бесплатен. Берём первый ПЛАТНЫЙ лазер — в стартовой сборке первый по счёту может быть даровым.
    const wi = world.player.loadout.weapons.findIndex((w) => w != null && isLaser(w) && w.cost > 0)
    const stockId = world.player.loadout.weapons[wi]!.id
    const base = findModule(stockId)!
    if (base.kind !== 'laser') throw new Error('сток лазера обязан быть лазером')

    // Ломаем лазер на месте и чиним ИМЕННО его (клон уже в слоте).
    const broken = withFault(world.player.loadout.weapons[wi]!, 0.5)
    world.player.loadout.weapons[wi] = broken as typeof broken & { kind: 'laser' }
    const faultBefore = moduleFault(broken)
    const money = world.credits
    const outcome = repairModule(world, world.player, broken)

    const now = world.player.loadout.weapons[wi]!
    if (outcome === 'repaired') {
      expect(moduleFault(now)).toBe(0)
      if (now.kind === 'laser') expect(now.damage).toBeCloseTo(base.damage, 5) // сила вернулась к стоку
      expect(world.credits).toBeLessThan(money) // за успех платят
    } else if (outcome === 'botched') {
      expect(moduleFault(now)).toBeGreaterThan(faultBefore) // доломали
      expect(world.credits).toBe(money) // за провал денег не берут
    } else {
      expect(moduleFault(now)).toBe(faultBefore) // refused/no-money — поломка не тронута
    }
  })
})
