import { describe, expect, it } from 'vitest'
import { COSMIC, Modules } from '@elite/sim'
import { RENDER } from './config'

/**
 * Космические импульсы достают ровно до предела отрисовки: что видно на экране, то и разбить.
 * Домен рендера не знает, поэтому число живёт в двух местах — равенство держит этот тест.
 */
describe('дальность космических импульсов', () => {
  it('равна дальней плоскости камеры', () => {
    expect(COSMIC.PULSE_RANGE).toBe(RENDER.FAR)
    expect(Modules.SHATTER_CANNON.range).toBe(RENDER.FAR)
    expect(Modules.SEED_PULSE.range).toBe(RENDER.FAR)
  })
})
