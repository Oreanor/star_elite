import { describe, expect, it } from 'vitest'
import { MODULE_CATALOGUE } from '../../config/modules'
import { isLaser } from '../loadout'

/**
 * Семейства военных лазеров — ХАРАКТЕР, а не плюс-минус: импульсные как класс слабее,
 * лучевые (непрерывные) сильнее. Свойство, а не числа: переживёт перебалансировку.
 */
describe('семейства военных лазеров', () => {
  const military = MODULE_CATALOGUE.filter(isLaser).filter((m) => !m.effect && m.cost > 0)
  // Урон в секунду: у луча `damage` уже в секунду, у импульсного — за выстрел.
  const dps = (m: (typeof military)[number]) => (m.beam ? m.damage : m.damage / m.cooldown)

  it('на каждом классе луч бьёт сильнее любого импульсного того же класса', () => {
    for (const cls of [1, 2, 3]) {
      const beams = military.filter((m) => m.beam && m.class === cls)
      const pulses = military.filter((m) => !m.beam && m.class === cls && m.id.startsWith('pulse'))
      if (beams.length === 0 || pulses.length === 0) continue
      expect(Math.min(...beams.map(dps)), `класс ${cls}`).toBeGreaterThan(Math.max(...pulses.map(dps)))
    }
  })

  it('плазма бьёт редко и тяжело, роторный — часто и мелко', () => {
    const plasma = military.filter((m) => m.id.startsWith('plasma'))
    const rotary = military.filter((m) => m.id.startsWith('rotary'))
    for (const p of plasma) for (const r of rotary) {
      expect(p.cooldown).toBeGreaterThan(r.cooldown * 5)
      expect(p.damage).toBeGreaterThan(r.damage * 5)
    }
  })
})
