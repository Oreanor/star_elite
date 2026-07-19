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

  /**
   * Стартовая — ДВОЙНАЯ и остаётся такой: на ней все начинают, и первый кадр обязан быть
   * тем самым. Здесь же стояла отладочная чёрная дыра «Глотка» — её убрали, и у причала
   * не должно остаться никакой: проверяем это поведением, чтобы отладочное не вернулось молча.
   */
  it('двойная звезда, и никакой чёрной дыры у причала', () => {
    const def = systemDefFor(SHARED_START_INDEX, GALAXY.SEED)
    expect(def.name).toBe('Люрилар')
    expect(def.companion).not.toBeNull()
    expect(def.companion?.kind).not.toBe('blackhole')

    const world = createWorld({ ...def, patrols: [], belt: null })
    const stars = world.bodies.filter((b) => b.kind === 'star')
    expect(stars).toHaveLength(2)
    expect(world.bodies.some((b) => b.kind === 'blackhole')).toBe(false)

    // Звёзды держат разнос на всех отметках времени: орбита двойной — не декорация.
    for (const calendarTime of [0, 60, 3_600, 86_400]) {
      world.calendarTime = calendarTime
      stepOrbits(world)
      expect(stars[0]!.pos.distanceTo(stars[1]!.pos)).toBeCloseTo(def.companion!.separation, 1)
    }
  })

  it('причал — Кресты (крест-каркас), не сгенерированный Кориолис', () => {
    const def = systemDefFor(SHARED_START_INDEX, GALAXY.SEED)
    expect(def.station?.name).toBe('Кресты')
    expect(def.station?.style).toBe('cross')

    const world = createWorld({ ...def, patrols: [], belt: null })
    const station = world.bodies.find((b) => b.kind === 'station')
    expect(station?.name).toBe('Кресты')
    expect(station?.stationStyle).toBe('cross')
  })
})
