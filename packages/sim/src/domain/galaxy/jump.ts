import { CORE_INDEX } from '../../config/galaxy'
import { isCruising } from '../cruise/drive'
import { enterSystem } from '../world/factory'
import type { SystemDef } from '../world/system'
import type { World } from '../world/entities'
import { arrivalPointAt, scatterArrival, type Arrival } from './arrival'
import { systemDefOf } from './bridge'
import { driftContacts } from './contacts'
import { syncLiveContactsFromShips } from '../world/plan'
import { spawnResidentContacts } from '../world/traffic'
import { generateSystem } from './generate'
import { applySharedStartWorld } from './sharedStart'
import { distanceLy, placeSystem } from './shape'
import { applyPlayerSave, serializePlayer } from '../save/player'

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

export type JumpBlock = 'no-drive' | 'out-of-range' | 'out-of-charge' | 'same-system' | 'docked' | 'cruising' | 'scaled'

export interface JumpOptions {
  /** Уже раскрытая и оплаченная пара устьев: обратные проходы не тратят заряд повторно. */
  establishedPortal?: boolean
}

function jumpAllowed(world: World, index: number, options: JumpOptions): boolean {
  const blocked = jumpBlock(world, index)
  if (blocked === null) return true
  // Оплаченный тоннель отменяет только требования привода/заряда/дальности.
  const physical = blocked === 'same-system' || blocked === 'docked' || blocked === 'cruising' || blocked === 'scaled'
  return options.establishedPortal === true && !physical
}

/**
 * Описание системы по индексу. Всё из зерна; у общего спавна (Люрилар) —
 * правка причала в `applySharedStartWorld`.
 */
export function systemDefFor(index: number, galaxySeed: number, seatOverride?: number): SystemDef {
  return applySharedStartWorld(
    systemDefOf(generateSystem(index, galaxySeed), galaxySeed, seatOverride),
    index,
    galaxySeed,
  )
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
  // На крейсерском ходу привод не пускает: сначала сбрось скорость до обычной.
  if (isCruising(world.player)) return 'cruising'
  // Коррекция миелофона меняет сам масштаб метрического кадра. Сшивать две системы
  // в этот момент нельзя: одно и то же устье получило бы разные физические размеры.
  if (world.player.state.scale !== 1) return 'scaled'
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
 * В пределах модели привода (заряд / круиз / док не смотрим).
 * Метка jumpTarget живёт только пока цель в этой сфере — иначе отваливается.
 */
export function jumpInDriveRange(world: World, index: number): boolean {
  if (index === world.systemIndex) return false
  const drive = world.player.spec.jumpRange
  if (drive <= 0) return false
  return jumpDistance(world, index) <= drive
}

/**
 * Зерно СЛЕДУЮЩЕЙ галактики из текущего.
 *
 * Детерминированная перемешка, а не `Math.random`: цепочка галактик за чёрными
 * дырами обязана быть одной и той же при том же старте — иначе ни сохранений, ни
 * сети. `>>> 0` держит результат беззнаковым 32-битным, как и `GALAXY.SEED`.
 */
function nextGalaxySeed(seed: number): number {
  // Вариант splitmix32: одного умножения и сдвигов хватает, чтобы соседние зёрна
  // давали непохожие галактики (иначе форма и имена «плывут» слабо от галактики к галактике).
  let x = (seed + 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0
  return (x ^ (x >>> 15)) >>> 0
}

/**
 * Прыгнуть. Возвращает false, если правила не пускают, — и мир при этом не тронут.
 * Проверка и действие обязаны быть одним решением, иначе они однажды разойдутся.
 *
 * `arrival` — куда именно выйти в той системе. `null` значит «куда обычно»:
 * к столице. Само правило живёт в `arrival.ts`, здесь только протаскивается.
 */
export function jump(
  world: World,
  index: number,
  arrival: Arrival | null = null,
  options: JumpOptions = {},
): boolean {
  if (!jumpAllowed(world, index, options)) return false
  // Дальность считаем ДО перехода: `enterSystem` сменит `systemIndex`, и отсчёт
  // сорвётся. Заряд тратится ровно на пройденный путь — сфера сжимается на него.
  const spent = jumpDistance(world, index)

  // Прыжок В ЯДРО — не перелёт внутри галактики, а проход сквозь чёрную дыру в
  // СЛЕДУЮЩУЮ. Достаточно сменить зерно галактики: все 2500 систем, их имена,
  // форма диска и цены — чистые функции зерна, и меняются разом. Выходим у чёрной
  // дыры новой галактики (её ядро) — там же, где вошли: дыра ведёт в дыру.
  const destIndex = isCore(index) ? CORE_INDEX : index
  if (isCore(index)) world.galaxySeed = nextGalaxySeed(world.galaxySeed)

  // Выбранная на карте станция (если станций несколько) становится местом выхода:
  // мир строит именно её. Разброс точки выхода растёт с длиной прыжка — короткий
  // кладёт впритык к цели, дальний рассеивает на километры (см. `scatterArrival`).
  const seatOverride = arrival?.kind === 'body' ? arrival.planet : undefined
  const def = systemDefFor(destIndex, world.galaxySeed, seatOverride)
  const drive = world.player.spec.jumpRange
  const start = scatterArrival(def, arrivalPointAt(def, arrival, world.calendarTime), drive > 0 ? spent / drive : 0, world.rng)
  syncLiveContactsFromShips(world)
  enterSystem(world, def, destIndex, start)
  if (!options.establishedPortal) {
    world.player.jumpCharge = Math.max(0, world.player.jumpCharge - spent)
  }

  // Прыжок — отрезок времени: сперва знакомые за кулисами делают ход (перелёт, гибель),
  // затем тех, чьё место — эта система, выставляем на радар. Порядок важен: сначала
  // сместить (`boundFor`/странствие), потом заселить — иначе только что прибывший
  // контакт был бы выставлен и тут же уведён собственным дрейфом. Оба шага — от
  // `world.rng`, сброшенного `enterSystem` к зерну системы: детерминизм для сети/реплея.
  driftContacts(world)
  spawnResidentContacts(world)
  return true
}

/**
 * Завершить прыжок в УЖЕ построенный World. Окружение не генерируется повторно:
 * переносим в него только свежего пилота и цену перехода. Это доменная операция,
 * чтобы клиент и будущий сервер одинаково решали, можно ли принять готовую систему.
 */
export function commitPreparedJump(
  source: World,
  destination: World,
  index: number,
  options: JumpOptions = {},
): boolean {
  if (destination.systemIndex !== index || !jumpAllowed(source, index, options)) return false

  const spent = jumpDistance(source, index)
  const destinationSeed = destination.galaxySeed
  applyPlayerSave(destination, {
    ...serializePlayer(source),
    galaxySeed: destinationSeed,
    systemIndex: destination.systemIndex,
  })
  if (!options.establishedPortal) {
    destination.player.jumpCharge = Math.max(0, source.player.jumpCharge - spent)
  }
  destination.time = source.time
  destination.calendarTime = source.calendarTime
  destination.epoch = source.epoch + 1
  destination.jumpTargetIndex = null
  destination.jumpArrivalPlanet = null
  return true
}

/** Ядро галактики — та самая чёрная дыра. Ворота в следующую галактику. */
export const isCore = (index: number) => index === CORE_INDEX
