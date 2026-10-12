import { describe, expect, it } from 'vitest'
import { CHASSIS_CATALOGUE } from '@elite/sim'
import { fromChassis, itemPoints, moveItem, printout, resizeItem, toEntry } from './rigModel'

/**
 * Модель редактора оснастки: оснастка корпуса разбирается на пункты, зеркальные точки — пары,
 * а печать повторяет раскладку конфигов игры (`chassis.ts` / `ships.ts`).
 */
describe('редактор оснастки', () => {
  const aurora = CHASSIS_CATALOGUE.find((c) => c.id === 'aurora_one')!
  const nozzles = [
    { offset: [-1.5, -0.7, 7.5] as const, radius: 1 },
    { offset: [1.5, -0.7, 7.5] as const, radius: 1 },
  ]

  it('зеркальные точки сводятся в пары: дула, подвесы, сопла', () => {
    const s = fromChassis(aurora, nozzles, 1)
    const lasers = s.items.filter((i) => i.kind === 'laser')
    expect(lasers.map((l) => l.pair)).toEqual([true, true, false]) // крыло, законцовки, нос
    expect(s.items.filter((i) => i.kind === 'pylon').every((p) => p.pair)).toBe(true)
    expect(s.items.filter((i) => i.kind === 'nozzle')).toHaveLength(1)
  })

  it('пара шире-уже симметрично и не проходит сквозь ось', () => {
    const s = fromChassis(aurora, nozzles, 1)
    const pair = s.items.find((i) => i.kind === 'nozzle')!
    moveItem(pair, -10, 0, 0)
    expect(pair.x).toBe(0)
    moveItem(pair, 2, 0, 0)
    expect(itemPoints(pair)).toEqual([
      [-2, -0.7, 7.5],
      [2, -0.7, 7.5],
    ])
  })

  it('размер: у сопла — радиус, у подвеса — ракеты всего корпуса', () => {
    const s = fromChassis(aurora, nozzles, 1)
    const nozzle = s.items.find((i) => i.kind === 'nozzle')!
    const pylon = s.items.find((i) => i.kind === 'pylon')!
    resizeItem(s, nozzle, 2)
    resizeItem(s, pylon, 1.5)
    expect(nozzle.radius).toBe(2)
    expect(s.missileScale).toBe(1.5)
  })

  it('печать: исходная оснастка воспроизводится строками конфига', () => {
    const text = printout(fromChassis(aurora, nozzles, 1))
    expect(text).toContain("{ offset: [0, -0.86, 0.53], kind: 'gun', maxClass: 2, nozzles: [[-3.82, -0.86, 0.53], [3.82, -0.86, 0.53]] },")
    expect(text).toContain("{ offset: [0, -0.87, -8.52], kind: 'gun', maxClass: 3, bore: 2, nozzles: [[0, -0.87, -8.52]] },")
    expect(text).toContain("{ offset: [-5, -0.8, 3], kind: 'pylon', maxClass: 1 },")
    expect(text).toContain('nozzles: [{ offset: [-1.5, -0.7, 7.5], radius: 1 }, { offset: [1.5, -0.7, 7.5], radius: 1 }],')
    expect(text).toContain('missileScale: 1,')
  })

  it('запись в игру сохраняет номера точек: оружие в сейвах не съедет на чужое место', () => {
    const s = fromChassis(aurora, nozzles, 1)
    const pylon = s.items.find((i) => i.kind === 'pylon')!
    moveItem(pylon, 1, 0, 0)
    const entry = toEntry(aurora, s)
    expect(entry.hardpoints!.map((h) => h.kind)).toEqual(aurora.hardpoints.map((h) => h.kind))
    expect(entry.hardpoints![3]!.offset).toEqual([-6, -0.8, 3]) // −x пары — на своём месте
    expect(entry.hardpoints![4]!.offset).toEqual([6, -0.8, 3])
    expect(entry.hardpoints![5]!.offset).toEqual(aurora.hardpoints[5]!.offset) // соседняя пара не тронута
    expect(entry.missileScale).toBe(1)
  })
})
