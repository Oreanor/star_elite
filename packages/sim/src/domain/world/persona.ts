import type { Rng } from '../../core/math'

/**
 * Личность пилота: кто он и как торгуется. ЧИСТЫЕ ДАННЫЕ — ни логики, ни сети.
 *
 * Персона нужна не физике, а разговору: избитый пират сдаётся охотнее, но и
 * трусливый — тоже, а волевого и умного собеседник переспорит скорее, чем
 * робкого. Иными словами, исход торга зависит не только от силы кораблей.
 *
 * Числа тут — сырьё для реплики (её сочиняет слой app через модель), а не для
 * шага симуляции. Поэтому персона раздаётся seeded-RNG ОДИН раз при рождении
 * корабля: тот же сид — тот же характер, и по сети синхронизируется как есть.
 * Внутри кадра её никто не бросает — иначе характер плыл бы от герцовки.
 */

/** Нрав: категориальная черта, задаёт тон. Числа рядом уточняют, слова — красят. */
export type Disposition =
  | 'brave' // дерзкий: стоит до последнего
  | 'cowardly' // трусливый: ломается рано
  | 'greedy' // жадный: всё меряет добычей
  | 'honorable' // честный: держит слово
  | 'hotheaded' // вспыльчивый: заводится с полуслова
  | 'calculating' // расчётливый: считает шансы

export const DISPOSITIONS: readonly Disposition[] = [
  'brave',
  'cowardly',
  'greedy',
  'honorable',
  'hotheaded',
  'calculating',
]

/**
 * Черты в шкале 1..5 (середина 3). Не 0..1: собеседнику-модели «воля 4 из 5»
 * читается вернее, чем «0.72», а сравнивать «мой 2 против его 4» — нагляднее.
 */
export interface Persona {
  /** Нрав словом. */
  disposition: Disposition
  /** Ум: считает ли последствия или живёт мгновением. */
  intellect: number
  /** Темперамент: спокоен (1) или взрывной (5). */
  temperament: number
  /** Харизма: умеет ли давить и убеждать. */
  charisma: number
  /** Воля: гнётся (1) или стоит на своём (5). */
  willpower: number
}

/** Ровно посередине по всем осям. Для кораблей, что рождены без RNG (тесты, дрон). */
export const DEFAULT_PERSONA: Persona = {
  disposition: 'calculating',
  intellect: 3,
  temperament: 3,
  charisma: 3,
  willpower: 3,
}

/** Черта 1..5 из RNG. */
function trait(rng: Rng): number {
  return 1 + Math.floor(rng() * 5)
}

/**
 * Случайная личность из seeded-RNG. Бросается при СОЗДАНИИ корабля, где RNG —
 * это `world.rng` (спавн — событие, а не шаг физики, и сдвиг генератора здесь
 * детерминирован сидом системы). Тот же сид — тот же характер у того же борта.
 */
export function makePersona(rng: Rng): Persona {
  const disposition = DISPOSITIONS[Math.floor(rng() * DISPOSITIONS.length)]!
  return {
    disposition,
    intellect: trait(rng),
    temperament: trait(rng),
    charisma: trait(rng),
    willpower: trait(rng),
  }
}
