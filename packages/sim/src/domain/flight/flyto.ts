import { Vector3 } from 'three'
import { AUTOPILOT } from '../../config/station'
import { clamp } from '../../core/math'
import type { Controller } from '../sim/controller'
import type { ShipEntity, World } from '../world/entities'
import { findBody, findShip } from '../world/queries'
import { steerToward } from './steering'

/**
 * Автопилот-НА-ЦЕЛЬ. Третий режим рядом с автостыковкой и автобоем: «лети к тому,
 * что захвачено» — борту (`lockedTargetId`) или станции (`lockedStationId`). В отличие
 * от автостыковки он не заходит в створ и не садится, а просто подводит нос к цели,
 * тормозит у неё и возвращает штурвал (см. `flyToArrived`).
 *
 * Это ОБЫЧНЫЙ Controller — тот же шов, что автостыковка: заполняет тот же `ShipControls`,
 * не зная физики, и не может ни разогнаться сверх паспорта, ни развернуться быстрее
 * маневровых. Состояния нет — всё читается из мира каждый шаг, включиться и выключиться
 * можно в любой момент.
 */

const _toTarget = new Vector3()
const _steer = { pitch: 0, yaw: 0 }

/** Куда ведём: позиция захваченного борта (живого) или станции. null — вести некуда. */
function targetPos(world: World): Vector3 | null {
  const ship = findShip(world, world.lockedTargetId)
  if (ship && ship !== world.player && ship.alive) return ship.state.pos
  const station = findBody(world, world.lockedStationId)
  if (station) return station.pos
  return null
}

export const flyToController: Controller = {
  update(ship: ShipEntity, world: World): void {
    const c = ship.controls
    c.roll = 0
    c.rudder = 0
    c.strafe = 0
    c.strafeUp = 0
    c.boost = 1
    c.retro = 0
    c.flightAssist = true

    const dest = targetPos(world)
    if (!dest) {
      c.throttle = 0
      return
    }

    _toTarget.copy(dest).sub(ship.state.pos)
    const distance = _toTarget.length()

    // Нос — на цель. Упреждение не берём: автопилот доставляет к точке, а не бьёт по ней;
    // подравняться под ход цели можно и вручную, забрав штурвал по прибытии.
    steerToward(ship.state, dest, 2.2, _steer)
    c.pitch = _steer.pitch
    c.yaw = _steer.yaw

    const speed = ship.state.vel.length()

    // Дошли — паркуемся: гасим ход у цели, дальше штурвал заберёт Simulation по flyToArrived.
    if (distance <= AUTOPILOT.ARRIVE_RANGE) {
      c.throttle = 0
      if (speed > AUTOPILOT.PARK_SPEED && _toTarget.dot(ship.state.vel) > 0) c.retro = 1
      return
    }

    // Скорость подхода падает с дистанцией — иначе автопилот влетает в цель на паспортных
    // сотнях метров в секунду. Тяга — доля потолка: лётный компьютер подтянет саму скорость.
    const wanted = clamp(
      (distance / AUTOPILOT.BRAKE_RANGE) * AUTOPILOT.APPROACH_SPEED,
      AUTOPILOT.CREEP_SPEED,
      AUTOPILOT.APPROACH_SPEED,
    )
    const cap = Math.max(ship.spec.tuning.MAX_SPEED, 1)
    c.throttle = clamp(wanted / cap, 0, 1)

    // Летим не туда, куда смотрит нос (проскочили, инерция) — гасим тягу и доворачиваемся.
    if (speed > AUTOPILOT.PARK_SPEED && _toTarget.dot(ship.state.vel) < 0) {
      c.throttle = 0
      c.retro = 1
    }
  },

  wantsFire(): boolean {
    // На автопилоте не стреляют — это поведение автопилота, а не запрет игроку.
    return false
  },
}

/** Есть ли куда вести: захвачен живой борт или станция, игрок жив и не пристыкован. */
export function canEngageFlyTo(world: World): boolean {
  if (!world.player.alive || world.docked) return false
  return targetPos(world) !== null
}

/**
 * Пора ли вернуть штурвал: цель пропала (сменил захват, борт погиб) или мы уже у неё
 * (в пределах ARRIVE_RANGE). Дистанция, а не время: за уходящей целью автопилот гнался бы,
 * пока сам не долетит или пока ей не поставят точку.
 */
export function flyToArrived(world: World): boolean {
  const dest = targetPos(world)
  if (!dest) return true
  return dest.distanceTo(world.player.state.pos) <= AUTOPILOT.ARRIVE_RANGE
}
