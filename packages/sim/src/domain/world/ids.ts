/**
 * Выдача идентификаторов. Счётчик модульный, а не глобальный статический:
 * иначе два мира в одном процессе (сервер!) начнут раздавать одинаковые id.
 */
export interface IdSource {
  next(): number
}

export function createIdSource(start = 1): IdSource {
  let n = start
  return { next: () => n++ }
}
