import { describe, expect, it } from 'vitest'
import { QUASAR } from '../../config/beams'
import { quasarLook } from './quasar'

describe('характер квазара', () => {
  it('у одного имени один облик, у разных — разные; джеты в заданной вилке', () => {
    const a = quasarLook('Дверь')
    expect(quasarLook('Дверь')).toEqual(a)
    const looks = ['Ядро', 'Дверь', 'Альфа', 'Омега', 'Тиррион'].map(quasarLook)
    expect(new Set(looks.map((l) => l.palette.toFixed(3))).size).toBeGreaterThan(1)
    for (const l of looks) {
      expect(l.jetLength).toBeGreaterThanOrEqual(QUASAR.JET_LENGTH_SPREAD[0])
      expect(l.jetLength).toBeLessThanOrEqual(QUASAR.JET_LENGTH_SPREAD[1])
    }
  })
})
