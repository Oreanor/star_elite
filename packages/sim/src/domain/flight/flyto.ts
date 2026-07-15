import { Vector3 } from 'three'
import { AUTOPILOT } from '../../config/station'
import { CRUISE } from '../../config/cruise'
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
 *
 * Два уточнения делают его пригодным для НАСТОЯЩИХ расстояний системы:
 *  — на дальнем ПРЯМОМ перегоне он просит ФОРСАЖ (`wantsCruise`), иначе до планеты в
 *    полумиллиарде метров он ползёт боевыми 220 м/с десятки минут;
 *  — курс ОГИБАЕТ тела на пути (`aimAround`), а не идёт носом сквозь звезду или планету.
 */

const _toTarget = new Vector3()
const _steer = { pitch: 0, yaw: 0 }
const _dir = new Vector3()
const _toBody = new Vector3()
const _closest = new Vector3()
const _lateral = new Vector3()
const _perp = new Vector3()
const _nose = new Vector3()
const _aim = new Vector3()

/** Куда ведём: позиция захваченного борта (живого) или станции. null — вести некуда. */
function targetPos(world: World): Vector3 | null {
  const ship = findShip(world, world.lockedTargetId)
  if (ship && ship !== world.player && ship.alive) return ship.state.pos
  const station = findBody(world, world.lockedStationId)
  if (station) return station.pos
  return null
}

/**
 * Точка прицеливания в обход тел. Идём вдоль луча к цели; если тело подходит к лучу ближе
 * зазора (радиус×AVOID_CLEARANCE + габарит борта) ДО цели — уводим аим вбок за его сферу,
 * и курс огибает тело. Берём БЛИЖАЙШЕЕ перекрывающее; пересчёт каждый кадр сам доворачивает
 * по мере облёта, а как тело останется позади — аим возвращается на цель.
 *
 * Возвращает `true`, если путь перекрыт (аим уведён): по нему `wantsCruise` глушит форсаж —
 * сверхсвет в обход планеты недопустим.
 */
function aimAround(ship: ShipEntity, world: World, dest: Vector3, out: Vector3): boolean {
  out.copy(dest)
  const pos = ship.state.pos
  _dir.copy(dest).sub(pos)
  const dist = _dir.length()
  if (dist < 1) return false
  _dir.multiplyScalar(1 / dist) // единичный курс на цель

  let nearest = Infinity
  let blocked = false
  for (const body of world.bodies) {
    if (body.id === world.lockedStationId) continue // это и есть цель, не препятствие
    _toBody.copy(body.pos).sub(pos)
    const along = _toBody.dot(_dir)
    if (along <= 0 || along >= dist) continue // тело позади борта или дальше цели
    _closest.copy(pos).addScaledVector(_dir, along) // ближайшая к телу точка луча
    _lateral.copy(_closest).sub(body.pos)
    const lat = _lateral.length()
    const clearance = body.radius * AUTOPILOT.AVOID_CLEARANCE + ship.spec.hull.radius
    if (lat >= clearance || along >= nearest) continue
    nearest = along
    blocked = true
    if (lat < 1) {
      // Луч идёт сквозь центр тела — бокового направления нет, берём любой перпендикуляр курсу.
      _perp.set(0, 1, 0)
      if (Math.abs(_dir.y) > 0.9) _perp.set(1, 0, 0)
      _lateral.copy(_perp).addScaledVector(_dir, -_perp.dot(_dir)).normalize()
    } else {
      _lateral.multiplyScalar(1 / lat)
    }
    // Аим — точка сбоку от тела, вынесенная ЗА зазор: курс идёт мимо, а не сквозь.
    out.copy(body.pos).addScaledVector(_lateral, clearance + AUTOPILOT.AVOID_MARGIN)
  }
  return blocked
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

    // Нос — на ТОЧКУ ОБХОДА (она же цель, когда путь свободен). Упреждение не берём:
    // автопилот доставляет к точке, а не бьёт по ней; подравняться под ход цели можно
    // и вручную, забрав штурвал по прибытии.
    aimAround(ship, world, dest, _aim)
    steerToward(ship.state, _aim, 2.2, _steer)
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

  /**
   * Форсаж на автоследовании — только на дальнем ПРЯМОМ перегоне и под тройной охраной:
   * есть место затормозить, нос наведён, путь чист. `updateCruise` добавит свои запреты
   * (массовая блокировка врагом, выход у звезды) — этот метод лишь ПРОСИТ разгон.
   */
  wantsCruise(ship: ShipEntity, world: World): boolean {
    const dest = targetPos(world)
    if (!dest) return false
    _toTarget.copy(dest).sub(ship.state.pos)
    const distance = _toTarget.length()

    // Хватает ли места погасить крейсерский ход до цели (тормозной путь ≈ v/DECAY_RATE).
    const cruiseSpeed = ship.spec.tuning.MAX_SPEED * CRUISE.MAX_FACTOR
    const brakeDist = cruiseSpeed / CRUISE.DECAY_RATE
    if (distance <= brakeDist * AUTOPILOT.CRUISE_BRAKE_MARGIN) return false

    // Нос уже на цели — иначе сверхсвет уносит боком. Нос корабля смотрит в −Z.
    _nose.set(0, 0, -1).applyQuaternion(ship.state.quat)
    _dir.copy(_toTarget).multiplyScalar(1 / Math.max(distance, 1))
    if (_nose.dot(_dir) < AUTOPILOT.CRUISE_ALIGN) return false

    // Прямой путь свободен от тел — крейсер не рулит в обход планеты.
    if (aimAround(ship, world, dest, _aim)) return false
    return true
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
