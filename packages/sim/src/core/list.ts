/**
 * Списки мира без мусора. Уборка и подсчёты идут КАЖДЫЙ такт (120 раз в секунду), и
 * `filter(...)` / `filter(...).length` там — новый массив на выброс за каждый вызов.
 */

/** Оставить в списке только то, что прошло проверку, — на месте, без нового массива. */
export function retain<T>(list: T[], keep: (item: T) => boolean): void {
  let n = 0
  for (const item of list) if (keep(item)) list[n++] = item
  list.length = n
}

/** Сколько элементов проходит проверку — без промежуточного массива. */
export function countWhere<T>(list: readonly T[], test: (item: T) => boolean): number {
  let n = 0
  for (const item of list) if (test(item)) n++
  return n
}
