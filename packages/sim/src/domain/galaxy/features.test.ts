import { describe, expect, it } from 'vitest'
import { generateGalaxy } from './generate'
import { hasFeature } from './features'
import { quasarOf } from './quasar'

describe('примечательные тела системы', () => {
  it('чёрная дыра в галактике одна, и квазар — это она же, когда ядро активно', () => {
    for (const seed of [1, 7, 42, 1234]) {
      const systems = generateGalaxy(seed)
      const holes = systems.filter((s) => hasFeature(s, 'blackhole', seed))
      const quasars = systems.filter((s) => hasFeature(s, 'quasar', seed))
      expect(holes).toHaveLength(1)
      expect(quasars).toHaveLength(quasarOf(seed) ? 1 : 0)
    }
  })

  it('руина и целая сфера Дайсона взаимоисключают друг друга', () => {
    const seed = 42
    for (const s of generateGalaxy(seed)) {
      expect(hasFeature(s, 'dyson', seed) && hasFeature(s, 'dysonRuin', seed)).toBe(false)
    }
  })
})
