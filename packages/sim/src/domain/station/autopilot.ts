import { Vector3 } from 'three'
import { AUTODOCK, DOCKING } from '../../config/station'
import { clamp } from '../../core/math'
import { steerToward } from '../flight/steering'
import type { Controller } from '../sim/controller'
import type { ShipEntity, World } from '../world/entities'
import { canDockAt, dock, findStation, stationRange } from './docking'

/**
 * Автостыковка.
 *
 * Это ОБЫЧНЫЙ Controller — тот самый шов, ради которого он и заводился. Автопилот
 * не двигает корабль и не знает физики: он заполняет тот же `ShipControls`, что
 * игрок мышью и бот головой. Поэтому он не может ни разогнаться сверх паспорта,
 * ни развернуться быстрее, чем позволяют маневровые.
 *
 * Состояния у него нет: всё, что нужно, читается из мира каждый шаг. Значит его
 * можно включить и выключить в любой момент, и он не «залипнет».
 */

const _toStation = new Vector3()
const _steer = { pitch: 0, yaw: 0 }

export const autodockController: Controller = {
  update(ship: ShipEntity, world: World): void {
    const c = ship.controls
    c.roll = 0
    c.rudder = 0
    c.strafe = 0
    c.strafeUp = 0
    c.boost = 1
    c.retro = 0
    c.flightAssist = true

    // Автопилот — это заявка на стыковку: даём кораблю допуск. Он открывает коридор
    // колец и пропускает сквозь защитное поле станции (иначе автопилот отпружинил бы
    // от собственного захода). Тот же флаг, каким NPC заходят на причал под защитой.
    ship.clearance = true

    const station = findStation(world)
    if (!station) {
      c.throttle = 0
      return
    }

    if (canDockAt(ship, station)) {
      dock(world)
      c.throttle = 0
      return
    }

    _toStation.copy(station.pos).sub(ship.state.pos)
    const range = stationRange(ship, station)

    // Ведём нос на причал. Упреждение не нужно: станция никуда не летит.
    steerToward(ship.state, station.pos, 2.2, _steer)
    c.pitch = _steer.pitch
    c.yaw = _steer.yaw

    // Скорость подхода падает с дистанцией — иначе автопилот влетает в кольцо
    // на паспортных двухстах метрах в секунду, и стыковка становится тараном.
    const wanted = clamp(
      (range / AUTODOCK.BRAKE_RANGE) * AUTODOCK.APPROACH_SPEED,
      AUTODOCK.CREEP_SPEED,
      AUTODOCK.APPROACH_SPEED,
    )

    // Тяга — доля от паспортного потолка: лётный компьютер сам подтянет скорость.
    const cap = Math.max(ship.spec.tuning.MAX_SPEED, 1)
    c.throttle = clamp(wanted / cap, 0, 1)

    // Летим не туда, куда смотрит нос — гасим тягу и доворачиваемся.
    const speed = ship.state.vel.length()
    if (speed > DOCKING.MAX_SPEED && _toStation.dot(ship.state.vel) < 0) {
      c.throttle = 0
      c.retro = 1
    }
  },

  wantsFire(): boolean {
    // На автопилоте не стреляют. Это не запрет игроку — это поведение автопилота.
    return false
  },
}

/** Дотянется ли автопилот до причала отсюда. */
export function canEngageAutodock(world: World): boolean {
  const station = findStation(world)
  if (!station || world.docked || !world.player.alive) return false
  return stationRange(world.player, station) < AUTODOCK.ENGAGE_RANGE
}
