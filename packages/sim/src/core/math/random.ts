import { Vector3 } from 'three'

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

/**
 * Случайное направление: точка куба [-1,1)³, отброшенная к единичной длине.
 * Нулевой вектор перебрасывается — нормировать его нечем.
 *
 * Распределение по сфере НЕ строго равномерное: углы кубa чуть плотнее осей. Для
 * «куда лететь встречному» и «где повисло гнездо» этого достаточно, а перебрасывать
 * точки вне шара — лишние броски и лишний расход `rng`, от которого зависит вся
 * дальнейшая генерация. Там, где равномерность важна (расстановка галактик в кусте),
 * стоит своя отбраковка по шару — см. `domain/universe`.
 *
 * Пишет в `out` и его же возвращает: горячий путь спавна не аллоцирует.
 */
export function randomUnit(rng: Rng, out: Vector3): Vector3 {
  do {
    out.set(signed(rng), signed(rng), signed(rng))
  } while (out.lengthSq() < 1e-6)
  return out.normalize()
}

/**
 * Взвешенный выбор. Природа неравномерна: красных карликов много,
 * голубых гигантов почти нет, землеподобных планет — единицы.
 *
 * Вес берётся функцией, а не полем: у встречи в трафике он зависит ещё и от
 * удалённости места, и своя копия выборки заводилась ровно из-за этого.
 */
export function weightedPick<T>(rng: Rng, table: readonly T[], weightOf: (item: T) => number): T {
  let total = 0
  for (const item of table) total += weightOf(item)
  let roll = rng() * total
  for (const item of table) {
    roll -= weightOf(item)
    if (roll <= 0) return item
  }
  return table[table.length - 1]!
}
