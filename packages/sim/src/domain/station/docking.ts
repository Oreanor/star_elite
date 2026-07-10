import { Vector3 } from 'three'
import { DOCKING } from '../../config/station'
import type { BodyEntity, ShipEntity, World } from '../world/entities'

/**
 * Стыковка. Домен знает только состояние «пристыкован» и условия входа-выхода;
 * ни кнопок, ни меню, ни автопилота здесь нет — автопилот это обычный Controller.
 */

const _toStation = new Vector3()
const _noseRest = new Vector3(0, 0, -1)

export function findStation(world: World): BodyEntity | null {
  return world.bodies.find((b) => b.kind === 'station') ?? null
}

/** Расстояние до причального кольца, м. Отрицательного не бывает. */
export function stationRange(ship: ShipEntity, station: BodyEntity): number {
  return Math.max(0, station.pos.distanceTo(ship.state.pos) - station.radius)
}

/**
 * Можно ли стыковаться прямо сейчас. Скорость важна не меньше дистанции:
 * влететь в причал на двухстах метрах в секунду — это не стыковка, а таран.
 */
export function canDockAt(ship: ShipEntity, station: BodyEntity): boolean {
  return (
    ship.alive &&
    stationRange(ship, station) < DOCKING.RANGE &&
    ship.state.vel.length() < DOCKING.MAX_SPEED
  )
}

export function dock(world: World): boolean {
  const station = findStation(world)
  if (!station || world.docked || !world.dockArmed || !canDockAt(world.player, station)) return false

  world.docked = true
  world.player.state.vel.set(0, 0, 0)
  world.player.state.angVel.set(0, 0, 0)
  world.player.controls.throttle = 0
  world.player.cruise.factor = 1
  return true
}

/**
 * Стыковка сама, без клавиши: подошёл к причалу тихо и близко — ты в доке.
 *
 * Взвод обязателен. Отчаливание выпускает корабль на `RELEASE_GAP` от кольца —
 * это ВНУТРИ `RANGE` — и на `RELEASE_SPEED`, что ниже `MAX_SPEED`. Без взвода
 * стыковка срабатывала в том же кадре, и меню станции возвращалось сразу после
 * нажатия «отчалить»: игрок успевал увидеть один кадр космоса. Условие входа —
 * не «ты рядом», а «ты пришёл снаружи».
 */
export function stepDocking(world: World): void {
  if (world.docked) return

  const station = findStation(world)
  if (!station) return

  // Покинул зону — стыковка снова возможна. Порог общий с `canDockAt`, поэтому
  // взвод никогда не срабатывает там, где стыковка уже разрешена.
  if (!world.dockArmed && stationRange(world.player, station) >= DOCKING.RANGE) world.dockArmed = true

  // Решает `dock()`: условия входа живут в одном месте, иначе их не проверить тестом.
  dock(world)
}

/** Выпускает корабль наружу, носом от станции: иначе первый же кадр — столкновение. */
export function undock(world: World): void {
  if (!world.docked) return
  world.docked = false
  world.dockArmed = false

  const station = findStation(world)
  const player = world.player
  if (!station) return

  _toStation.copy(player.state.pos).sub(station.pos)
  if (_toStation.lengthSq() < 1e-6) _toStation.set(0, 0, 1)
  _toStation.normalize()

  player.state.pos.copy(station.pos).addScaledVector(_toStation, station.radius + DOCKING.RELEASE_GAP)
  player.state.vel.copy(_toStation).multiplyScalar(DOCKING.RELEASE_SPEED)

  // Разворачиваем носом наружу: смотреть в станцию при отчаливании незачем.
  player.state.quat.setFromUnitVectors(_noseRest, _toStation)
  player.state.angVel.set(0, 0, 0)
  player.controls.throttle = 0.3
}
