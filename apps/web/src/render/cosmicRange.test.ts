import { describe, expect, it } from 'vitest'
import { COSMIC, Modules } from '@elite/sim'
import { RENDER } from './config'

/**
 * Разбивающий шар достаёт ровно до предела отрисовки: что видно на экране, то и разбить.
 * Домен рендера не знает, поэтому число живёт в двух местах — равенство держит этот тест.
 */
describe('дальность разбивающего шара', () => {
  it('равна дальней плоскости камеры', () => {
    expect(COSMIC.SHATTER_RANGE).toBe(RENDER.FAR)
    expect(Modules.SHATTER_CANNON.range).toBe(RENDER.FAR)
  })
})
