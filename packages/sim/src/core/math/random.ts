/**
 * Детерминированный ГПСЧ. В домене `Math.random()` запрещён:
 * симуляция с недетерминированным шумом не синхронизируется по сети
 * ни лок-степом, ни откатом. Все случайности приходят отсюда.
 */
export interface Rng {
  /** [0, 1) */
  (): number
}

/** mulberry32 — быстрый, с равномерным распределением, одного слова состояния хватает. */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0
  return function rng(): number {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** [-1, 1) */
export function signed(rng: Rng): number {
  return rng() * 2 - 1
}

export function range(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo)
}
