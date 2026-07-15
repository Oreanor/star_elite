import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { WORLD } from '../../config/world'
import { createWorld } from '../world'
import { stepOrbits } from '../world/orbits'
import { systemDefFor } from './jump'
import { SHARED_START_INDEX } from './sharedStart'

describe('онлайн-старт Люрилар', () => {
  it('индекс 1 при родном зерне — общая точка спавна', () => {
    expect(SHARED_START_INDEX).toBe(WORLD.SHARED_START_INDEX)
  })

  it('сохраняет звезду B, а «Глотку» держит в 25 000 км от станции', () => {
    const def = systemDefFor(SHARED_START_INDEX, GALAXY.SEED)
    expect(def.name).toBe('Люрилар')
    expect(def.companion).not.toBeNull()
    expect(def.companion?.kind).not.toBe('blackhole')

    const world = createWorld({ ...def, patrols: [], belt: null })
    const bh = world.bodies.find((b) => b.kind === 'blackhole')
    const stars = world.bodies.filter((b) => b.kind === 'star')
    const station = world.bodies.find((b) => b.kind === 'station')
    expect(stars).toHaveLength(2)
    expect(bh?.name).toBe('Глотка')
    expect(bh?.orbit?.parentId).toBe(station?.id)

    for (const calendarTime of [0, 60, 3_600, 86_400]) {
      world.calendarTime = calendarTime
      stepOrbits(world)
      expect(station!.pos.distanceTo(bh!.pos)).toBeCloseTo(25_000_000, 1)
      expect(stars[0]!.pos.distanceTo(stars[1]!.pos)).toBeCloseTo(def.companion!.separation, 1)
    }
  })
})
