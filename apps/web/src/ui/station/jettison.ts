import {
  COMMODITIES,
  jettisonCommodity,
  jettisonItem,
  placeFigurineFromHold,
  type CargoItem,
  type Commodity,
  type World,
} from '@elite/sim'
import { pushWarning } from '../../session/warnings'

/**
 * Выброс груза за борт — один путь для трюма и окна сделки. Статуэтка встаёт исполином по
 * носу (пересечение режем, тесный зазор — жёлтый пуш), прочее летит контейнером, руда — камнем.
 */

function isFigurine(c: Commodity): boolean {
  return c.id === COMMODITIES.FIGURINE.id
}

/** Одна статуэтка по носу; `no-room` → жёлтый пуш. Пересечение — молча. */
function dumpFigurine(world: World, index: number): boolean {
  const result = placeFigurineFromHold(world, world.player, index)
  if (result === 'no-room') pushWarning('noRoom', world.time)
  return result === 'ok'
}

/** Предмет трюма целиком. Индекс — из живого трюма в миг клика: соседи сдвигают список. */
export function dumpItem(world: World, item: CargoItem): boolean {
  const index = world.player.hold.items.indexOf(item)
  if (index < 0) return false
  if (item.kind === 'commodity' && isFigurine(item.commodity)) return dumpFigurine(world, index)
  return jettisonItem(world, world.player, index)
}

/** `units` единиц товара — сколько выставлено ползунком. Возвращает выброшенное. */
export function dumpUnits(world: World, commodity: Commodity, units: number): number {
  if (!isFigurine(commodity)) return jettisonCommodity(world, world.player, commodity, units)
  // Статуэтки — по одной: каждая встаёт в своё место по носу, пока оно есть.
  let done = 0
  while (done < units) {
    const index = world.player.hold.items.findIndex((i) => i.kind === 'commodity' && isFigurine(i.commodity))
    if (index < 0 || !dumpFigurine(world, index)) break
    done++
  }
  return done
}

/** Весь трюм: статуэтки — по одной, пока место есть; остальное — контейнерами. */
export function dumpAll(world: World): boolean {
  let changed = false
  let i = 0
  while (i < world.player.hold.items.length) {
    const item = world.player.hold.items[i]!
    // Удача — тот же индекс: предмет ушёл (список сдвинулся) или от стопки статуэток выложили
    // одну и выкладываем следующую. Отказ (статуэтке нет места) — идём дальше.
    if (dumpItem(world, item)) changed = true
    else i++
  }
  return changed
}
