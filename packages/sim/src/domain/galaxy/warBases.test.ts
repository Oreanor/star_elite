import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { WARBASE_GEN } from '../../config/warbase'
import { generateGalaxy } from './generate'
import { capitalOf } from './types'
import { warBasesOf } from './warBases'

/**
 * Военные базы в генерации: сколько — от строя, строит только средний тех, ненаселённые
 * изредка хранят заброшенную, а каждая десятая «вооружённая» — параноидальная, с базой у
 * каждой планеты. Держим свойства, а не числа: перебалансировка таблицы не должна ломать тест.
 */
describe('военные базы в генерации', () => {
  const galaxy = generateGalaxy(GALAXY.SEED)
  const plans = galaxy.map((s) => ({ s, bases: warBasesOf(s, GALAXY.SEED) }))

  it('одно зерно — одни базы', () => {
    for (const { s, bases } of plans.slice(0, 200)) expect(warBasesOf(s, GALAXY.SEED)).toEqual(bases)
  })

  it('слишком отсталые и слишком развитые миры баз не строят', () => {
    for (const { s, bases } of plans) {
      const cap = capitalOf(s)
      if (!cap || bases.length === 0) continue
      expect(cap.settlement.techLevel).toBeGreaterThanOrEqual(WARBASE_GEN.TECH_MIN)
      expect(cap.settlement.techLevel).toBeLessThanOrEqual(WARBASE_GEN.TECH_MAX)
    }
  })

  it('обычно одна-две; параноидальные — по базе у каждой планеты', () => {
    let paranoid = 0
    let armed = 0
    for (const { s, bases } of plans) {
      if (bases.length === 0) continue
      armed++
      const atPlanets = bases.filter((b) => b.anchorPlanet != null)
      if (atPlanets.length > 0) {
        paranoid++
        expect(atPlanets.length).toBe(s.planets.length)
      } else expect(bases.length).toBeLessThanOrEqual(2)
    }
    expect(paranoid).toBeGreaterThan(0)
    // Редкость — около одной из десяти вооружённых, а не каждая вторая.
    expect(paranoid / armed).toBeLessThan(0.25)
  })

  it('ненаселённые системы изредка хранят заброшенную базу', () => {
    const empty = plans.filter(({ s }) => !capitalOf(s))
    const abandoned = empty.filter(({ bases }) => bases.length > 0)
    expect(abandoned.length).toBeGreaterThan(0)
    expect(abandoned.length / empty.length).toBeLessThan(0.3)
    for (const { bases } of abandoned) expect(bases[0]!.name).toMatch(/Заброшенная/)
  })
})
