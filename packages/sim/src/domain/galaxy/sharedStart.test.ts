import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { WORLD } from '../../config/world'
import { createWorld } from '../world'
import { bodyMass } from '../flight/gravity'
import { stepOrbits } from '../world/orbits'
import { systemDefFor } from './jump'
import { SHARED_START_INDEX } from './sharedStart'

describe('онлайн-старт Люрилар', () => {
  it('индекс 1 при родном зерне — общая точка спавна', () => {
    expect(SHARED_START_INDEX).toBe(WORLD.SHARED_START_INDEX)
  })

  it('вместо звезды B — чёрная дыра «Глотка» на орбите барицентра', () => {
    const def = systemDefFor(SHARED_START_INDEX, GALAXY.SEED)
    expect(def.name).toBe('Люрилар')
    expect(def.companion?.kind).toBe('blackhole')
    if (def.companion?.kind !== 'blackhole') return
    expect(def.companion.name).toBe('Глотка')
    expect(def.companion.visualRadius).toBeGreaterThan(def.companion.radius)

    const world = createWorld({ ...def, patrols: [], belt: null })
    const bh = world.bodies.find((b) => b.kind === 'blackhole')
    const stars = world.bodies.filter((b) => b.kind === 'star')
    expect(stars).toHaveLength(1)
    expect(bh?.name).toBe('Глотка')
    expect(bh?.visualRadius).toBe(def.companion.visualRadius)
    expect(bh?.visualRadius).toBeGreaterThan(bh!.radius)
    expect(bh?.orbit).not.toBeNull()

    const star = stars[0]!
    const bhMass = bodyMass(bh!)
    expect(bhMass / bodyMass(star)).toBeGreaterThan(0.3)
    expect(bhMass / bodyMass(star)).toBeLessThan(1.5)

    // Пара вращается, но не разъезжается: сумма барицентрических радиусов
    // всегда равна исходному separation генератора.
    for (const calendarTime of [0, 60, 3_600, 86_400]) {
      world.calendarTime = calendarTime
      stepOrbits(world)
      expect(star.pos.distanceTo(bh!.pos)).toBeCloseTo(def.companion.separation, 1)
    }
  })
})
