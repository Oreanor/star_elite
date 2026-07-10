import { describe, expect, it } from 'vitest'
import { DYSON } from '../../config/dyson'
import { GALAXY } from '../../config/galaxy'
import { generateGalaxy } from './generate'
import { capitalOf } from './types'

/**
 * Сферы Дайсона.
 *
 * Декорация, но не случайная: её строят на вершине прогресса. Проверяем именно
 * это правило — что сфера метит высокотех, — а не облик (облик знает рендер).
 */

describe('сферы Дайсона', () => {
  it('редки: их единицы процентов галактики', () => {
    const galaxy = generateGalaxy(GALAXY.SEED)
    const share = galaxy.filter((s) => s.dyson !== null).length / galaxy.length
    expect(share).toBeGreaterThan(0.003)
    expect(share).toBeLessThan(0.05)
  })

  it('целую сферу строят только у столиц высшего тех-уровня', () => {
    for (const system of generateGalaxy(GALAXY.SEED)) {
      if (!system.dyson || system.dyson.ruined) continue
      const capital = capitalOf(system)
      expect(capital).not.toBeNull()
      expect(capital!.settlement.techLevel).toBeGreaterThanOrEqual(DYSON.MIN_TECH)
    }
  })

  it('облик — из таблицы видов, а не за её пределами', () => {
    for (const system of generateGalaxy(GALAXY.SEED)) {
      if (!system.dyson) continue
      expect(system.dyson.variant).toBeGreaterThanOrEqual(0)
      expect(system.dyson.variant).toBeLessThan(DYSON.VARIANTS)
    }
  })

  it('встречаются все виды, а не один', () => {
    const seen = new Set<number>()
    for (const system of generateGalaxy(GALAXY.SEED)) {
      if (system.dyson) seen.add(system.dyson.variant)
    }
    expect(seen.size).toBe(DYSON.VARIANTS)
  })

  /**
   * Руины — редкость на редкость, и стоят они не на вершине прогресса, а над
   * угасшей жизнью: тех-уровень столицы НИЖЕ порога целой сферы. Целые же —
   * наоборот, только у высокотеха. Так руина читается как «павшая», а не «строится».
   */
  it('целые — у высокотеха, руины — у скромных миров', () => {
    let intact = 0
    let ruined = 0
    for (const system of generateGalaxy(GALAXY.SEED)) {
      if (!system.dyson) continue
      const tech = capitalOf(system)!.settlement.techLevel
      if (system.dyson.ruined) {
        ruined++
        expect(tech).toBeLessThan(DYSON.MIN_TECH)
      } else {
        intact++
        expect(tech).toBeGreaterThanOrEqual(DYSON.MIN_TECH)
      }
    }
    // Оба сорта существуют, и руин заметно меньше целых.
    expect(intact).toBeGreaterThan(0)
    expect(ruined).toBeGreaterThan(0)
    expect(ruined).toBeLessThan(intact)
  })
})
