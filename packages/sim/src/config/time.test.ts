import { describe, expect, it } from 'vitest'
import { TIME, calendarMs, calendarSec } from './time'

describe('calendar time', () => {
  it('на якоре календарь на нуле эпохи', () => {
    expect(calendarMs(TIME.ANCHOR_REAL_MS)).toBe(TIME.EPOCH_MS)
    expect(calendarSec(TIME.ANCHOR_REAL_MS)).toBe(0)
  })

  it('одна реальная секунда — одна игровая секунда календаря (дата × SCALE)', () => {
    const oneRealSecLater = TIME.ANCHOR_REAL_MS + 1000
    expect(calendarSec(oneRealSecLater)).toBe(1)
    expect(calendarMs(oneRealSecLater)).toBe(TIME.EPOCH_MS + 1000 * TIME.SCALE)
  })
})
