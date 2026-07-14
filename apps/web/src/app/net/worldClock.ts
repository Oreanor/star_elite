import { calendarMs, calendarSec } from '@elite/sim'
import { onValue, ref } from 'firebase/database'
import { rtdb } from './firebase'

/**
 * Общие игровые часы для всех клиентов.
 *
 * Календарь считается от фиксированной эпохи (`TIME.ANCHOR_REAL_MS` в sim) по реальным
 * UTC-часам, сжатым в `TIME.SCALE`. Онлайн подтягиваем смещение Firebase Server Time,
 * чтобы часы не расходились между машинами. Офлайн — `Date.now()` с тем же якорем.
 *
 * `world.time` в симуляции — другое: локальные секунды физики (замирает в доке).
 * HUD, станция и журналы знакомств живут здесь.
 */

let offsetMs = 0
let started = false

/** Подписаться на смещение Firebase Server Time (безопасно вызывать многократно). */
export function initWorldClock(): void {
  if (started) return
  started = true
  if (!rtdb) return
  onValue(ref(rtdb, '.info/serverTimeOffset'), (snap) => {
    const v = snap.val()
    offsetMs = typeof v === 'number' ? v : 0
  })
}

/** Реальный UTC-момент, синхронизированный с сервером Firebase (если онлайн). */
export function syncedRealMs(): number {
  return Date.now() + offsetMs
}

/** Текущий игровой момент, мс (календарь ~3000 года). */
export function gameTimeMs(): number {
  return calendarMs(syncedRealMs())
}

/** Игровые секунды календаря — для `world.calendarTime` и журналов. */
export function gameTimeSec(): number {
  return calendarSec(syncedRealMs())
}
