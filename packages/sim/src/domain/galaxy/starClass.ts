import {
  CORE_INDEX,
  GALAXY,
  STAR_CLASSES,
  type StarClassId,
} from '../../config/galaxy'
import { WORLD } from '../../config/world'
import { makeRng, type Rng } from '../../core/math'
import { systemName } from './names'

/**
 * Класс главной звезды по индексу — тот же бросок, что `makeStar` в generateSystem.
 *
 * В generateSystem ДО звезды идёт `systemName(rng)`: пустоты гигантов обязаны
 * прогнать тот же префикс, иначе класс разъедется с каталогом и гигантов
 * начнёт толкать чужой пузырь. Полный generateSystem из placeSystem — рекурсия.
 */

function weightedPick<T extends { readonly weight: number }>(rng: Rng, table: readonly T[]): T {
  let total = 0
  for (const item of table) total += item.weight
  let roll = rng() * total
  for (const item of table) {
    roll -= item.weight
    if (roll <= 0) return item
  }
  return table[table.length - 1]!
}

/** Спектральный класс первичной звезды системы (без радиуса и массы). */
export function primaryClassId(index: number, seed: number = GALAXY.SEED): StarClassId {
  if (index === CORE_INDEX) return 'H'
  if (index === WORLD.HOME_INDEX && seed === GALAXY.SEED) return 'G'
  const rng = makeRng(seed ^ Math.imul(index, 0x9e3779b1))
  systemName(rng) // тот же префикс, что в generateSystem — результат не нужен
  return weightedPick(rng, STAR_CLASSES).id
}

/** Радиус пустоты класса, св.г. Ноль — гигант не вытесняет соседей. */
export function voidLyOf(classId: StarClassId): number {
  const c = STAR_CLASSES.find((s) => s.id === classId)
  return c?.voidLy ?? 0
}
