import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { createWorld, type World } from '../world'
import { STARTER_SYSTEM } from '../world/system'
import { stepWorld } from './step'

/** Прокрутить мир `seconds` секунд кадрами по `frameDt`, без пилотов. */
function run(world: World, frameDt: number, seconds: number): void {
  const frames = Math.round(seconds / frameDt)
  for (let i = 0; i < frames; i++) stepWorld(world, frameDt, new Map())
}

/** Отпечаток мира: кто есть, где стоит и куда дошёл поток случайности. */
function fingerprint(world: World): string {
  const ships = world.ships.map((s) => `${s.id}:${s.state.pos.toArray().map((v) => v.toFixed(3)).join(',')}`)
  return [world.time.toFixed(6), world.rng(), world.asteroids.length, world.bolts.length, ...ships].join('|')
}

describe('частота кадров', () => {
  /**
   * Регрессия: трафик, киты, турели и уборка шли раз в КАДР, с кадровым `dt`. Каждый вызов
   * трафика бросает `world.rng`, поэтому на 120 Гц бросков вдвое больше, чем на 60, — и одно
   * зерно давало разный мир на разных мониторах. Теперь всё идёт в такте: те же такты — тот
   * же мир, сколько бы кадров их ни нарезало.
   */
  it('одно зерно — один мир на 60 и на 120 кадрах', () => {
    const at60 = createWorld(STARTER_SYSTEM)
    const at120 = createWorld(STARTER_SYSTEM)

    // Кадр на 60 Гц — ровно два такта, на 120 — один: нарезка разная, такты те же.
    expect(1 / 60).toBe(2 * PHYSICS.FIXED_DT)
    run(at60, 1 / 60, 90)
    run(at120, 1 / 120, 90)

    expect(at60.ships.length).toBeGreaterThan(0)
    expect(fingerprint(at60)).toBe(fingerprint(at120))
  })
})
