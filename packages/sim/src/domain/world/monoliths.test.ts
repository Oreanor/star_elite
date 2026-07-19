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
    // Каждый облик — ровно один: разные статуи, а не одна и та же в копиях.
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
    expect(world.scenicRocks).toHaveLength(0)
  })

  it('у Люцифера лежит пояс глыб километрового класса', () => {
    const world = createWorld()
    const lucifer = world.monoliths.find((m) => m.variant === 0)
    expect(lucifer).toBeDefined()
    expect(world.scenicRocks).toHaveLength(MONOLITH.ROCK_COUNT)
    for (const rock of world.scenicRocks) {
      expect(rock.alive).toBe(true)
      expect(rock.hull).toBeGreaterThan(0)
      expect(rock.radius).toBeGreaterThanOrEqual(MONOLITH.ROCK_RADIUS_MIN)
      expect(rock.radius).toBeLessThanOrEqual(MONOLITH.ROCK_RADIUS_MAX)
      const d = rock.pos.distanceTo(lucifer!.pos)
      expect(d).toBeGreaterThan(lucifer!.radius * MONOLITH.ROCK_GAP_MIN * 0.9)
      expect(d).toBeLessThan(lucifer!.radius * MONOLITH.ROCK_GAP_MAX * 1.2)
    }
  })

  /** Их надо МОЧЬ выбрать: Shift+Tab листает тела и статуи одним кругом. */
  it('выбираются нав-целью наравне с телами', () => {
    const world = createWorld()
    const ids = new Set(world.monoliths.map((m) => m.id))
    // Круг конечен — за число тел со статуями и глыбами он обязан пройти по всем.
    const total = world.bodies.length + world.monoliths.length + world.scenicRocks.length
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

  /** Глыбы двора — тоже нав-цели: иначе видимый камень нельзя выбрать Shift+Tab. */
  it('глыбы двора выбираются нав-целью коричневым родом asteroid', () => {
    const world = createWorld()
    const ids = new Set(world.scenicRocks.map((r) => r.id))
    expect(ids.size).toBeGreaterThan(0)
    const total =
      world.bodies.length + world.monoliths.length + world.scenicRocks.length + 1
    let hit = false
    for (let i = 0; i < total + 2; i++) {
      cycleCelestial(world)
      if (world.navTargetId !== null && ids.has(world.navTargetId)) {
        hit = true
        const nav = navTarget(world)
        expect(nav).not.toBeNull()
        expect(nav!.kind).toBe('asteroid')
        expect(nav!.radius).toBeGreaterThanOrEqual(MONOLITH.ROCK_RADIUS_MIN)
        break
      }
    }
    expect(hit).toBe(true)
  })
})
