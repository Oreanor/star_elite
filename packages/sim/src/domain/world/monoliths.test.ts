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
/**
 * Мир в системе, где статуи ЕСТЬ. Их число теперь бросок 0..COUNT_MAX по сиду, и ноль —
 * законный исход, поэтому тесты про сами статуи обязаны сперва найти подходящую систему.
 * Перебор детерминированный (индексы подряд), никаких магических номеров.
 */
function worldWith(has: (world: ReturnType<typeof createWorld>) => boolean): ReturnType<typeof createWorld> {
  // ОДИН мир, в который переходим системами: `createWorld` в цикле обходился в сотни
  // построений подряд и упирал соседние файлы тестов в таймаут.
  const world = createWorld()
  for (let i = 0; i < 200; i++) {
    enterSystem(world, STARTER_SYSTEM, i)
    if (has(world)) return world
  }
  throw new Error('не нашлось системы, подходящей под условие')
}

const withStatues = () => worldWith((w) => w.monoliths.length > 0)


describe('монолиты у причала', () => {
  /**
   * Числом статуй распоряжается сид: 0..COUNT_MAX. Ноль — законный исход и норма, поэтому
   * проверяем ГРАНИЦЫ и уникальность обликов, а не конкретное число. Раньше их было ровно
   * `VARIANTS` у каждого причала — исполин, стоящий всюду, диковиной быть перестаёт.
   */
  it('стоят у причала: не больше COUNT_MAX, все облики разные', () => {
    const world = createWorld()
    expect(world.bodies.some((b) => b.kind === 'station')).toBe(true)
    expect(world.monoliths.length).toBeGreaterThanOrEqual(0)
    expect(world.monoliths.length).toBeLessThanOrEqual(MONOLITH.COUNT_MAX)
    // Двух одинаковых у одного причала не бывает: это разные статуи, а не копии.
    expect(new Set(world.monoliths.map((m) => m.variant)).size).toBe(world.monoliths.length)
  })

  /**
   * Разброс по галактике: при 0..2 на систему обязаны встречаться и пустые причалы, и
   * занятые. Если бы бросок выродился в константу, тест это поймал бы — а именно константой
   * оно и было.
   */
  it('по системам число статуй разное: есть и пустые причалы, и со статуями', () => {
    const counts = new Set<number>()
    const world = createWorld()
    for (let i = 0; i < 40; i++) {
      enterSystem(world, STARTER_SYSTEM, i)
      counts.add(world.monoliths.length)
    }
    expect(counts.size).toBeGreaterThan(1)
    expect(Math.max(...counts)).toBeLessThanOrEqual(MONOLITH.COUNT_MAX)
  })

  /**
   * РЕГРЕССИЯ. `enterSystem` чистит эфемерные списки, и расстановка стояла ВЫШЕ этой чистки:
   * статуи честно рождались и тут же стирались в том же кадре — в игре их не было вовсе.
   * Порядок здесь не косметика, поэтому и проверяем его поведением.
   */
  it('переживают вход в систему, а не стираются чисткой списков', () => {
    // `withStatues` сама зовёт enterSystem — именно её чистка списков и стирала статуи.
    const world = withStatues()
    expect(world.monoliths.length).toBeGreaterThan(0)
  })

  it('стоят ПОДАЛЬШЕ причала, а не внутри него', () => {
    const world = withStatues()
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
    expect(world.warBases).toHaveLength(0)
  })

  it('военные базы встают из данных системы у причала', () => {
    const world = createWorld({
      ...STARTER_SYSTEM,
      warBases: [{ name: 'База', radius: 1_500, stationOffset: [10_000, 0, 0], model: 0 }],
    })
    const station = world.bodies.find((b) => b.kind === 'station')!
    expect(world.warBases).toHaveLength(1)
    const base = world.warBases[0]!
    expect(base.alive).toBe(true)
    expect(base.radius).toBe(1_500)
    expect(base.hull).toBeGreaterThan(0)
    // Стоит у причала — на заданном смещении.
    expect(base.pos.distanceTo(station.pos)).toBeCloseTo(10_000, 0)
  })

  /** Их надо МОЧЬ выбрать: Shift+Tab листает тела и статуи одним кругом. */
  it('выбираются нав-целью наравне с телами', () => {
    const world = withStatues()
    const ids = new Set(world.monoliths.map((m) => m.id))
    // Круг конечен — за число тел со статуями и глыбами он обязан пройти по всем.
    const total = world.bodies.length + world.monoliths.length + world.warBases.length
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

  /** Военные базы — тоже нав-цели: иначе видимую базу нельзя выбрать Shift+Tab. */
  it('военные базы выбираются нав-целью', () => {
    const world = createWorld({
      ...STARTER_SYSTEM,
      warBases: [{ name: 'База', radius: 1_500, stationOffset: [10_000, 0, 0], model: 0 }],
    })
    const ids = new Set(world.warBases.map((r) => r.id))
    expect(ids.size).toBeGreaterThan(0)
    const total =
      world.bodies.length + world.monoliths.length + world.warBases.length + 1
    let hit = false
    for (let i = 0; i < total + 2; i++) {
      cycleCelestial(world)
      if (world.navTargetId !== null && ids.has(world.navTargetId)) {
        hit = true
        const nav = navTarget(world)
        expect(nav).not.toBeNull()
        expect(nav!.kind).toBe('asteroid')
        expect(nav!.radius).toBe(1_500)
        break
      }
    }
    expect(hit).toBe(true)
  })
})
