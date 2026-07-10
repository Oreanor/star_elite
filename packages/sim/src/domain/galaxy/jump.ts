import { CORE_INDEX, GALAXY } from '../../config/galaxy'
import { WORLD } from '../../config/world'
import { enterSystem } from '../world/factory'
import { STARTER_SYSTEM, type SystemDef } from '../world/system'
import type { World } from '../world/entities'
import { systemDefOf } from './bridge'
import { generateSystem } from './generate'
import { distanceLy, placeSystem } from './shape'

/**
 * Межзвёздный прыжок.
 *
 * Правила живут здесь, а не в интерфейсе карты: они одинаковы на клиенте и на
 * сервере и проверяются без всякого браузера. Карта лишь показывает то, что
 * посчитано тут, — сфера радиуса прыжка на ней и есть `spec.jumpRange`.
 *
 * Топлива пока нет: заправка от звезды придумывается отдельно. Единственные
 * ограничения — наличие привода и его дальность.
 */

export type JumpBlock = 'no-drive' | 'out-of-range' | 'same-system' | 'docked'

/**
 * Описание системы по индексу.
 *
 * Родная система задана вручную: настоящее Солнце, настоящая Земля, станция там,
 * где висит МКС. С неё начинается игра, и первый кадр обязан быть тем самым.
 * Всё остальное выводится из зерна — 2500 систем, ни одна не хранится.
 */
export function systemDefFor(index: number, galaxySeed: number): SystemDef {
  if (index === WORLD.HOME_INDEX && galaxySeed === GALAXY.SEED) return STARTER_SYSTEM
  return systemDefOf(generateSystem(index, galaxySeed), galaxySeed)
}

/** Расстояние до системы, световых лет. Диск не заворачивается — метрика прямая. */
export function jumpDistance(world: World, index: number): number {
  return distanceLy(placeSystem(world.systemIndex, world.galaxySeed), placeSystem(index, world.galaxySeed))
}

/**
 * Почему прыжок невозможен. `null` — возможен.
 *
 * Причина названа, а не спрятана в булев `false`: карта обязана объяснить пилоту,
 * покупать ему привод помощнее или просто отчалить от станции.
 */
export function jumpBlock(world: World, index: number): JumpBlock | null {
  if (world.docked) return 'docked'
  if (index === world.systemIndex) return 'same-system'

  const range = world.player.spec.jumpRange
  if (range <= 0) return 'no-drive'
  if (jumpDistance(world, index) > range) return 'out-of-range'
  return null
}

/** Системы, до которых достаёт привод. Их и подсвечивает карта. */
export function reachableSystems(world: World, indices: readonly number[]): number[] {
  return indices.filter((i) => jumpBlock(world, i) === null)
}

/**
 * Прыгнуть. Возвращает false, если правила не пускают, — и мир при этом не тронут.
 * Проверка и действие обязаны быть одним решением, иначе они однажды разойдутся.
 */
export function jump(world: World, index: number): boolean {
  if (jumpBlock(world, index) !== null) return false
  enterSystem(world, systemDefFor(index, world.galaxySeed), index)
  return true
}

/** Ядро галактики — та самая чёрная дыра. Ворота в следующую галактику. */
export const isCore = (index: number) => index === CORE_INDEX
