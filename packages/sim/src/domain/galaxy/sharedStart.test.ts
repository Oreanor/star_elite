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
  /**
   * Двойная звезда — не требование, а то, что выпало зерну: домашняя галактика теперь узел
   * куста, и её содержимое диктует слово «Слово». Требование ровно одно и оно жёсткое —
   * НИКАКОЙ ЧЁРНОЙ ДЫРЫ у общего старта: новичок появляется здесь, и падать ему в неё
   * с первой секунды незачем.
   */
  it('у общего старта звезда не чёрная дыра, но есть «Дверь»', () => {
    const def = systemDefFor(SHARED_START_INDEX, GALAXY.SEED)
    expect(def.name).toBe('Люрилар')
    // ЗВЕЗДА дырой быть не должна: новичок появляется здесь, падать ему некуда.
    expect(def.companion?.kind).not.toBe('blackhole')

    const world = createWorld({ ...def, patrols: [], belt: null })
    const stars = world.bodies.filter((b) => b.kind === 'star')
    expect(stars.length).toBeGreaterThanOrEqual(1)

    // А вот ДВЕРЬ — отдельное тело и обязана быть: это единственный вход на куст галактик,
    // и стоит она в общем старте, а не в тестовом STARTER_SYSTEM (там её игра не увидит).
    const door = world.bodies.find((b) => b.kind === 'blackhole')
    expect(door?.name).toBe('Дверь')
    const station = world.bodies.find((b) => b.kind === 'station')!
    // Далеко от причала: рядом она возмущала бы гравитацией стартовую зону.
    expect(door!.pos.distanceTo(station.pos)).toBeGreaterThan(10_000)

    // Если зерно всё же дало двойную — разнос держится на всех отметках времени: орбита
    // двойной не декорация. Одиночной звезде проверять нечего, и это НЕ повод падать.
    const companion = def.companion
    if (companion && stars.length === 2) {
      for (const calendarTime of [0, 60, 3_600, 86_400]) {
        world.calendarTime = calendarTime
        stepOrbits(world)
        expect(stars[0]!.pos.distanceTo(stars[1]!.pos)).toBeCloseTo(companion.separation, 1)
      }
    }
  })

  /**
   * Причал у общего старта — ОБЫЧНЫЙ. Крест «Кресты» отсюда уехал: он монумент центру
   * вселенной и стоит в корне куста галактик, в особом пространстве, а не в жилой системе.
   * Стеречь надо именно это: стоит кресту вернуться сюда — и монумент вселенной снова
   * окажется у игрока во дворе, обесценив и себя, и дорогу к себе.
   */
  it('причал у общего старта обычный: крест сюда не возвращается', () => {
    const def = systemDefFor(SHARED_START_INDEX, GALAXY.SEED)
    expect(def.station).not.toBeNull()
    expect(def.station?.name).not.toBe('Кресты')
    expect(def.station?.style).not.toBe('cross')

    const world = createWorld({ ...def, patrols: [], belt: null })
    const station = world.bodies.find((b) => b.kind === 'station')
    expect(station).toBeDefined()
    expect(station?.stationStyle).not.toBe('cross')
  })
})
