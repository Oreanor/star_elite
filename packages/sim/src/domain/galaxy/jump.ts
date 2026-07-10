import { CORE_INDEX, GALAXY } from '../../config/galaxy'
import { WORLD } from '../../config/world'
import { enterSystem } from '../world/factory'
import { STARTER_SYSTEM, type SystemDef } from '../world/system'
import type { World } from '../world/entities'
import { arrivalPoint, type Arrival } from './arrival'
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
 * Дальность прыжка — не постоянная привода, а его ЗАРЯД: сфера сжимается с каждым
 * прыжком на пройденный путь и восполняется у звезды. Поэтому «слишком далеко»
 * бывает двух родов: не хватит даже полного бака (нужен привод помощнее) или бак
 * просто опустел (нужно к светилу).
 */

export type JumpBlock = 'no-drive' | 'out-of-range' | 'out-of-charge' | 'same-system' | 'docked'

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

  const drive = world.player.spec.jumpRange
  if (drive <= 0) return 'no-drive'

  const distance = jumpDistance(world, index)
  // Дальше предела МОДЕЛИ — не долетишь и с полным баком: нужен привод помощнее.
  if (distance > drive) return 'out-of-range'
  // В пределах модели, но заряд израсходован: к звезде за топливом.
  if (distance > world.player.jumpCharge) return 'out-of-charge'
  return null
}

/** Системы, до которых достаёт привод. Их и подсвечивает карта. */
export function reachableSystems(world: World, indices: readonly number[]): number[] {
  return indices.filter((i) => jumpBlock(world, i) === null)
}

/**
 * Прыгнуть. Возвращает false, если правила не пускают, — и мир при этом не тронут.
 * Проверка и действие обязаны быть одним решением, иначе они однажды разойдутся.
 *
 * `arrival` — куда именно выйти в той системе. `null` значит «куда обычно»:
 * к столице. Само правило живёт в `arrival.ts`, здесь только протаскивается.
 */
export function jump(world: World, index: number, arrival: Arrival | null = null): boolean {
  if (jumpBlock(world, index) !== null) return false
  // Дальность считаем ДО перехода: `enterSystem` сменит `systemIndex`, и отсчёт
  // сорвётся. Заряд тратится ровно на пройденный путь — сфера сжимается на него.
  const spent = jumpDistance(world, index)
  const def = systemDefFor(index, world.galaxySeed)
  enterSystem(world, def, index, arrivalPoint(def, arrival))
  world.player.jumpCharge = Math.max(0, world.player.jumpCharge - spent)
  return true
}

/** Ядро галактики — та самая чёрная дыра. Ворота в следующую галактику. */
export const isCore = (index: number) => index === CORE_INDEX
