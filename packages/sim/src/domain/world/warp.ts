import { Vector3 } from 'three'
import type { ShipEntity, WarpFlash, World } from './entities'

/**
 * Гиперпереходы чужих кораблей.
 *
 * Приход и уход — одно событие для рендера: росчерк на месте борта. Домен лишь
 * ставит вспышку и, на выходе, убирает корабль. Кто РЕШАЕТ уйти — дело ИИ (страх
 * плюс редкий шанс); здесь только исполнение, чтобы «как» жило в одном месте.
 */

/** Оставить вспышку перехода. `arriving` — пришёл (true) или уходит (false). */
export function spawnWarpFlash(world: World, pos: Vector3, arriving: boolean): void {
  const flash: WarpFlash = { pos: pos.clone(), born: world.time, arriving }
  world.warps.push(flash)
}

/**
 * Уйти из системы прыжком. Не гибель: ни взрыва, ни трофеев, ни награды — борт
 * просто исчезает здесь, оставив вспышку. Пометку снимает уборка (`cleanup`),
 * отдельно от убитых: смешать их значило бы либо дать награду за сбежавшего, либо
 * взорвать ушедшего.
 */
export function jumpOut(world: World, ship: ShipEntity): void {
  spawnWarpFlash(world, ship.state.pos, false)
  ship.warpedOut = true
}
