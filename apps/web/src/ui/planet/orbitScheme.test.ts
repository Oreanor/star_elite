import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { BodyEntity } from '@elite/sim'
import { orbitScheme } from './orbitScheme'

const body = (kind: BodyEntity['kind'], radius: number, x: number): BodyEntity =>
  ({ kind, radius, pos: new Vector3(x, 0, 0) }) as BodyEntity

describe('схема спутников', () => {
  const planet = body('planet', 6_371_000, 0)
  // Причал на высоте 500 км, Луна на 60 R, ещё одна крупная рядом с Луной.
  const station = body('station', 1000, 6_871_000)
  const moonA = body('moon', 1_737_000, 384_000_000)
  const moonB = body('moon', 1_500_000, 420_000_000)

  it('кольца идут в настоящем порядке высот: причал на низкой орбите — внутри', () => {
    const slots = orbitScheme(planet, [moonA, station, moonB])
    expect(slots.map((s) => s.body)).toEqual([station, moonA, moonB])
  })

  it('соседние шары не касаются', () => {
    const slots = orbitScheme(planet, [moonA, station, moonB])
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]!.ring - slots[i - 1]!.ring).toBeGreaterThan(slots[i]!.size + slots[i - 1]!.size)
    }
    expect(slots[0]!.ring - slots[0]!.size).toBeGreaterThan(1)
  })

  it('внутренний обгоняет внешнего', () => {
    const slots = orbitScheme(planet, [moonA, station, moonB])
    for (let i = 1; i < slots.length; i++) expect(slots[i]!.rate).toBeLessThanOrEqual(slots[i - 1]!.rate)
  })

  it('пару лун не прижимает друг к другу скачок от низкого причала', () => {
    // Регрессия: шаг от логарифма орбит отдавал весь кадр скачку «причал → луна», и две луны
    // Ардина (7.2 R и 11.3 R — сорок их радиусов друг от друга) рисовались впритирку.
    const small = body('planet', 4_410_000, 0)
    const low = body('station', 1000, 4_880_000)
    const a = body('moon', 430_000, 31_750_000)
    const b = body('moon', 480_000, 49_900_000)
    const slots = orbitScheme(small, [low, a, b])
    expect(slots[2]!.ring - slots[1]!.ring).toBeGreaterThanOrEqual(0.5)
  })
})
