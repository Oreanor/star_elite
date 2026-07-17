import { describe, expect, it } from 'vitest'
import { MONOLITH } from '../../config/monoliths'
import { createWorld, enterSystem } from './factory'
import { cycleCelestial, navTarget } from './queries'
import { STARTER_SYSTEM } from './system'

/**
 * Монолиты — статуи-исполины у причала. Проверяем не координаты, а ИНВАРИАНТЫ:
 * они появляются там, где есть причал; их можно выбрать нав-целью; и — главное — они
 * ПЕРЕЖИВАЮТ вход в систему.
 */
describe('монолиты у причала', () => {
  it('стоят у причала: по одному на облик', () => {
    const world = createWorld()
    expect(world.bodies.some((b) => b.kind === 'station')).toBe(true)
    expect(world.monoliths).toHaveLength(MONOLITH.VARIANTS)
    // Каждый облик — ровно один: три статуи, а не три одинаковых.
    expect(new Set(world.monoliths.map((m) => m.variant)).size).toBe(MONOLITH.VARIANTS)
  })

  /**
   * РЕГРЕССИЯ. `enterSystem` чистит эфемерные списки, и расстановка стояла ВЫШЕ этой чистки:
   * статуи честно рождались и тут же стирались в том же кадре — в игре их не было вовсе.
   * Порядок здесь не косметика, поэтому и проверяем его поведением.
   */
  it('переживают вход в систему, а не стираются чисткой списков', () => {
    const world = createWorld()
    enterSystem(world, STARTER_SYSTEM, 0)
    expect(world.monoliths).toHaveLength(MONOLITH.VARIANTS)
  })

  it('стоят ПОДАЛЬШЕ причала, а не внутри него', () => {
    const world = createWorld()
    const station = world.bodies.find((b) => b.kind === 'station')!
    for (const m of world.monoliths) {
      const d = m.pos.distanceTo(station.pos)
      // Не ближе своего радиуса от станции — иначе статуя стояла бы прямо в причале.
      expect(d).toBeGreaterThan(MONOLITH.RADIUS)
    }
  })

  // Сдвиг начала координат статуи не отрывает от причала — проверено в `origin.test.ts`
  // вместе со всем прочим, у чего есть место в мире.

  it('в системе БЕЗ причала статуй нет — им не у чего стоять', () => {
    const world = createWorld({ ...STARTER_SYSTEM, station: null, extraStations: [] })
    expect(world.monoliths).toHaveLength(0)
  })

  /** Их надо МОЧЬ выбрать: Shift+Tab листает тела и статуи одним кругом. */
  it('выбираются нав-целью наравне с телами', () => {
    const world = createWorld()
    const ids = new Set(world.monoliths.map((m) => m.id))
    // Круг конечен — за число тел со статуями он обязан пройти по всем.
    const total = world.bodies.length + world.monoliths.length
    let hitMonolith = false
    for (let i = 0; i < total + 2; i++) {
      cycleCelestial(world)
      if (world.navTargetId !== null && ids.has(world.navTargetId)) {
        hitMonolith = true
        // И резолвер обязан узнать её: иначе приборы нав-цель не покажут.
        const nav = navTarget(world)
        expect(nav).not.toBeNull()
        expect(nav!.kind).toBe('monolith')
        expect(nav!.radius).toBe(MONOLITH.RADIUS)
        break
      }
    }
    expect(hitMonolith).toBe(true)
  })
})
