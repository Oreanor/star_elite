import { describe, expect, it } from 'vitest'
import { createWorld, slovoAtHome } from '@elite/sim'
import { BUSH_TRAFFIC } from './config'
import { bushPlayerPoint, bushTravellers, resetBushTraffic, stepBushTraffic } from './bushTraffic'
import { resetTorusFlight } from './torusFlight'

/**
 * Путники куста: инварианты, а не числа. Они живут на S³ и летят по большим кругам, рождаются
 * в ближней части тумана и — бог среди них только в отлучке, дома он сидит на Крестах.
 */

const DT = 1 / 120
/** Игровые сутки в единицах calendarTime (календарь ускорен ×480). */
const DAY = 180

function momentWhen(seed: number, home: boolean): number {
  for (let t = 0; t < 400 * DAY; t += DAY) if (slovoAtHome(seed, t) === home) return t
  throw new Error('расписание застряло')
}

function dot(a: Float64Array, b: Float64Array): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!
}

describe('путники куста', () => {
  it('остаются на 3-сфере, летят по касательной и рождаются в ближней части тумана', () => {
    resetTorusFlight()
    resetBushTraffic()
    const world = createWorld()
    const me = bushPlayerPoint(new Float64Array(4))
    let seen = 0
    for (let i = 0; i < 120 * 600; i++) {
      stepBushTraffic(world, DT)
      for (const b of bushTravellers) {
        if (!b.alive) continue
        expect(Math.abs(dot(b.p, b.p) - 1)).toBeLessThan(1e-6)
        expect(Math.abs(dot(b.p, b.t))).toBeLessThan(1e-6)
        if (b.life > BUSH_TRAFFIC.LIFE * 1.3 - DT * 2) {
          // Только что родился: угол до игрока — в заданном поясе.
          const gamma = Math.acos(Math.max(-1, Math.min(1, dot(b.p, me))))
          expect(gamma).toBeGreaterThanOrEqual(BUSH_TRAFFIC.SPAWN_MIN_RAD - 1e-6)
          expect(gamma).toBeLessThanOrEqual(BUSH_TRAFFIC.SPAWN_MAX_RAD + 0.01)
        }
        seen++
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('бог не ходит по кусту, пока он дома на Крестах', () => {
    resetTorusFlight()
    resetBushTraffic()
    const world = createWorld()
    world.calendarTime = momentWhen(world.galaxySeed, true)
    // Час игры крупным шагом: темп путников — в секундах, шаг такта на него не влияет.
    for (let i = 0; i < 2 * 3600; i++) {
      stepBushTraffic(world, 0.5)
      for (const b of bushTravellers) if (b.alive) expect(b.god).toBe(false)
    }
  })

  it('в отлучке бог на кусте встречается', () => {
    resetTorusFlight()
    resetBushTraffic()
    const world = createWorld()
    world.calendarTime = momentWhen(world.galaxySeed, false)
    let god = false
    for (let i = 0; i < 2 * 3600 && !god; i++) {
      stepBushTraffic(world, 0.5)
      for (const b of bushTravellers) if (b.alive && b.god) god = true
    }
    expect(god).toBe(true)
  })
})

