import { describe, expect, it } from 'vitest'
import { generateSystem } from './generate'

/**
 * Луны. Регрессия: размер не зависел от планеты (у скалы в 3800 км спутник в 3000 км),
 * а диапазоны орбит соседних лун перекрывались — вторая садилась внутрь первой, и
 * крупные шары бегали друг по другу.
 */
describe('луны', () => {
  const systems = Array.from({ length: 400 }, (_, i) => generateSystem(i, 1234))
  const planets = systems.flatMap((s) => s.planets)

  it('луна заметно меньше своей планеты — не больше трети', () => {
    for (const p of planets) for (const m of p.moons) expect(m.radius).toBeLessThanOrEqual(p.radius * 0.31)
  })

  it('орбиты идут лестницей, и соседние луны не касаются друг друга', () => {
    for (const p of planets) {
      for (let i = 1; i < p.moons.length; i++) {
        const a = p.moons[i - 1]!
        const b = p.moons[i]!
        expect(b.orbit).toBeGreaterThan(a.orbit)
        // Ближайшее сближение двух шаров — разность радиусов орбит (в радиусах планеты).
        expect((b.orbit - a.orbit) * p.radius).toBeGreaterThan(2 * (a.radius + b.radius))
      }
    }
  })

  it('ни одна луна не внутри предела Роша', () => {
    for (const p of planets) for (const m of p.moons) expect(m.orbit).toBeGreaterThanOrEqual(3)
  })
})
