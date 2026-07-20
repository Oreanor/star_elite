import { Vector3 } from 'three'
import { GALAXY_FLIGHT } from '../../config/galaxy'
import { MIELOPHONE } from '../../config/mielophone'
import { AUTOPILOT } from '../../config/station'
import { CRUISE } from '../../config/cruise'
import { PHYSICS } from '../../config/physics'
import { clamp } from '../../core/math'
import { placeSystem } from '../galaxy/shape'
import type { Controller } from '../sim/controller'
import { galaxyAnchorLocal, metersPerLy, speedScaleFactor } from '../scale/scale'
import type { ShipEntity, World } from '../world/entities'
import { findShip, navTarget } from '../world/queries'
import { steerToward } from './steering'

/**
 * Автопилот-НА-ЦЕЛЬ. Третий режим рядом с автостыковкой и автобоем: «лети к тому,
 * что в фокусе» — последний перебор. Tab (`targetFocus: contact`) → захваченный борт;
 * Shift+Tab / карта (`targetFocus: nav`) → нав-тело или статуя; на галактическом
 * масштабе Tab пишет `jumpTargetIndex` (захват системы недоступен) — J ведёт туда.
 * В отличие от автостыковки он не заходит в створ и не садится, а просто подводит
 * нос к цели, тормозит у неё и возвращает штурвал (см. `flyToArrived`).
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
 * К галактической звезде — тоже форсаж на дальнем плече; тормоз режем по BRAKE_LY
 * (системный путь ×40M·scale длиннее св.года кадра — иначе крейсер никогда не включится).
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
const _jumpPos = new Vector3()
const _anchor = new Vector3()

type Dest = {
  pos: Vector3
  radius: number
  bodyId: number | null
  /** Галактический перегон: мягкий газ, без крейсера, прибытие в св.г. */
  galaxy: boolean
}

/**
 * Мировая (локальная) точка выбранной звезды галактики.
 * Оси как у слоя: мир(x,y,z) ← ly(x,z,y). Якорь — true-coords слоя или своя звезда.
 */
function jumpStarDestination(world: World): Dest | null {
  const idx = world.jumpTargetIndex
  if (idx == null || idx === world.systemIndex) return null
  // Ниже GHOST_BODY св.годы в метрах абсурдны — J там про нав/контакт.
  if (world.player.state.scale < MIELOPHONE.GHOST_BODY_SCALE) return null

  const origin = placeSystem(world.systemIndex, world.galaxySeed)
  const star = placeSystem(idx, world.galaxySeed)
  const mPerLy = metersPerLy(world.player.state.scale)
  const dx = (star.x - origin.x) * mPerLy
  const dy = (star.z - origin.z) * mPerLy
  const dz = (star.y - origin.y) * mPerLy

  galaxyAnchorLocal(world, _anchor)
  _jumpPos.set(_anchor.x + dx, _anchor.y + dy, _anchor.z + dz)
  // radius = зона прибытия: approachDist дойдёт до 0 за ARRIVE_LY до точки.
  return { pos: _jumpPos, radius: GALAXY_FLIGHT.ARRIVE_LY * mPerLy, bodyId: null, galaxy: true }
}

/** Куда ведём и какой «поверхностный» радиус цели (у борта — 0: точка). null — вести некуда. */
function destination(world: World): Dest | null {
  // Галактика: Tab/карта → jumpTarget. Захвата системы нет — это и есть «цель» для J.
  const jump = jumpStarDestination(world)
  if (jump) return jump

  // Фокус — единственный ответ «куда J»: захваты независимы, иначе пират перебивает планету.
  if (world.targetFocus === 'nav') {
    const nav = navTarget(world)
    if (!nav) return null
    // Автопилот «к планете» означает выйти к ней, а не целиться в центр шара.
    // Сфера 2R оставляет один радиус высоты — достаточно, чтобы штатно погасить ход.
    return {
      pos: nav.pos,
      radius: nav.radius * AUTOPILOT.BODY_STANDOFF_RADII,
      bodyId: nav.id,
      galaxy: false,
    }
  }
  const ship = findShip(world, world.lockedTargetId)
  if (ship && ship !== world.player && ship.alive) {
    return { pos: ship.state.pos, radius: 0, bodyId: null, galaxy: false }
  }
  return null
}

/** Дистанция до «зоны прибытия»: у тела — до поверхности, у борта — до центра. */
function approachDist(from: Vector3, dest: { pos: Vector3; radius: number }): number {
  return Math.max(0, from.distanceTo(dest.pos) - dest.radius)
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
function aimAround(
  ship: ShipEntity,
  world: World,
  dest: Vector3,
  skipBodyId: number | null,
  out: Vector3,
): boolean {
  out.copy(dest)
  const pos = ship.state.pos
  _dir.copy(dest).sub(pos)
  const dist = _dir.length()
  if (dist < 1) return false
  _dir.multiplyScalar(1 / dist) // единичный курс на цель

  let nearest = Infinity
  let blocked = false
  for (const body of world.bodies) {
    if (skipBodyId !== null && body.id === skipBodyId) continue // это и есть цель, не препятствие
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

/** Газ к галактической звезде: доля потолка от дистанции в св.г, без полного хода. */
function galaxyThrottle(distanceM: number, scale: number): number {
  const mPerLy = metersPerLy(scale)
  const distLy = distanceM / mPerLy
  if (distLy <= 0) return 0
  if (distLy >= GALAXY_FLIGHT.BRAKE_LY) return GALAXY_FLIGHT.THROTTLE_CRUISE
  // Линейно от CRUISE на BRAKE_LY к CREEP на ARRIVE (ARRIVE уже вычтен в approachDist).
  const t = distLy / GALAXY_FLIGHT.BRAKE_LY
  return GALAXY_FLIGHT.THROTTLE_CREEP
    + t * (GALAXY_FLIGHT.THROTTLE_CRUISE - GALAXY_FLIGHT.THROTTLE_CREEP)
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

    const dest = destination(world)
    if (!dest) {
      c.throttle = 0
      return
    }

    const distance = approachDist(ship.state.pos, dest)

    // Нос — на ТОЧКУ ОБХОДА (она же цель, когда путь свободен). Упреждение не берём:
    // автопилот доставляет к точке, а не бьёт по ней; подравняться под ход цели можно
    // и вручную, забрав штурвал по прибытии.
    aimAround(ship, world, dest.pos, dest.bodyId, _aim)
    steerToward(ship.state, _aim, 2.2, _steer)
    c.pitch = _steer.pitch
    c.yaw = _steer.yaw

    const speed = ship.state.vel.length()
    _toTarget.copy(dest.pos).sub(ship.state.pos)

    // Дошли — паркуемся. У галактики radius уже = ARRIVE_LY·м/св.г → distance≤0 в зоне.
    const arrived = dest.galaxy ? distance <= 0 : distance <= AUTOPILOT.ARRIVE_RANGE
    if (arrived) {
      c.throttle = 0
      // Дистанция ещё не означает остановку: на ×scale борт пересекает всю зону за
      // один шаг. Ручник гасит полный вектор и крейсер независимо от направления.
      if (speed > AUTOPILOT.PARK_SPEED) c.retro = 1
      return
    }

    // Фиксированная BRAKE_RANGE годится лишь для выбора желаемой скорости. Решение
    // «тормозить уже сейчас» обязано следовать из ФАКТИЧЕСКОГО хода: при ×scale тот
    // же газ даёт пропорционально большую скорость, и борт иначе пересекает всю зону
    // прибытия между двумя фиксированными шагами. Для экспоненциального ручника
    // v(t)=v₀·e⁻ᵏᵗ, а полный выбег равен v₀/k.
    const rawDistance = _toTarget.length()
    const closingSpeed = rawDistance > 1
      ? Math.max(0, ship.state.vel.dot(_toTarget) / rawDistance)
      : 0
    const handbrakeDistance = closingSpeed / PHYSICS.HANDBRAKE_RATE
    if (closingSpeed > AUTOPILOT.PARK_SPEED
      && handbrakeDistance * AUTOPILOT.CRUISE_BRAKE_MARGIN >= distance) {
      c.throttle = 0
      c.retro = 1
      return
    }

    if (dest.galaxy) {
      c.throttle = galaxyThrottle(distance, ship.state.scale)
    } else {
      /**
       * Не разгоняемся сильнее, чем успеем ПОГАСИТЬ до цели. Ручник экспоненциальный
       * (v(t)=v₀·e⁻ᵏᵗ), полный выбег равен v/k — значит из дистанции прямо следует
       * потолок хода: v ≤ distance·k, с запасом CRUISE_BRAKE_MARGIN на реакцию.
       *
       * Отсюда же само собой уходят и петли: радиус разворота равен v²/a, и раз скорость
       * ограничена дистанцией, борту всегда хватает места довернуть вектор внутрь. Раньше
       * потолок задавала одна лишь BRAKE_RANGE — фиксированные четыре километра, — и на
       * настоящих системных дистанциях автопилот успевал разогнаться так, что пролетал
       * цель насквозь и уходил на второй круг.
       */
      const stoppable = (distance * PHYSICS.HANDBRAKE_RATE) / AUTOPILOT.CRUISE_BRAKE_MARGIN
      /**
       * Потолки подхода — В МАСШТАБЕ БОРТА. Сами по себе `APPROACH_SPEED` и `CREEP_SPEED`
       * заданы для единичного корабля, и на миелофонных масштабах гигант полз к цели теми
       * же шестьюстами метрами в секунду — при том, что его собственный корпус длиной в
       * тысячи километров. Дистанции растут вместе с бортом, значит и скорость обязана.
       *
       * Сам `stoppable` в множителе не нуждается: он выведен из дистанции и частоты ручника
       * (1/с), то есть уже пропорционален масштабу и остаётся верным на любом.
       */
      const k = speedScaleFactor(ship.state.scale)
      const wanted = clamp(
        Math.min((distance / (AUTOPILOT.BRAKE_RANGE * k)) * AUTOPILOT.APPROACH_SPEED * k, stoppable),
        AUTOPILOT.CREEP_SPEED * k,
        AUTOPILOT.APPROACH_SPEED * k,
      )
      const cap = Math.max(ship.spec.tuning.MAX_SPEED, 1)
      c.throttle = clamp(wanted / cap, 0, 1)
    }

    /**
     * СРЫВ В ПЕТЛЮ. Прежняя проверка ловила только уже проскочившего (произведение < 0),
     * а борт на большом ходу в цель и не летел, и от неё не удалялся — он ходил ВОКРУГ.
     *
     * Считаем, а не угадываем: рулевой доворачивает НОС быстро, но вектор скорости —
     * только боковым ускорением, и радиус разворота равен v²/a. Стоит ему превысить
     * дистанцию до цели, и попасть внутрь нельзя никаким рулением: борт наматывает круги,
     * пока не кончится терпение. Единственное лекарство — сбросить скорость, потому что
     * радиус падает как КВАДРАТ от неё.
     *
     * Мерим по косинусу между ходом и направлением на цель: пока он ниже LOOP_ALIGN,
     * газ снят и ручник затянут. Дистанция сюда не входит намеренно — на подходе тот же
     * критерий гасит и «занос» мимо цели.
     */
    if (speed > AUTOPILOT.PARK_SPEED) {
      const toLen = _toTarget.length()
      const align = toLen > 1 ? ship.state.vel.dot(_toTarget) / (toLen * speed) : 1
      if (align < AUTOPILOT.LOOP_ALIGN) {
        c.throttle = 0
        c.retro = 1
      }
    }
  },

  wantsFire(): boolean {
    // На автопилоте не стреляют — это поведение автопилота, а не запрет игроку.
    return false
  },

  /**
   * Форсаж на автоследовании — на дальнем ПРЯМОМ перегоне (система и галактика).
   * Охрана: место затормозить, нос наведён; в системе ещё путь чист от тел.
   * `updateCruise` добавит массовую блокировку / выход у звезды — здесь лишь просьба.
   */
  wantsCruise(ship: ShipEntity, world: World): boolean {
    const dest = destination(world)
    if (!dest) return false
    const distance = approachDist(ship.state.pos, dest)
    if (distance <= 0) return false

    if (dest.galaxy) {
      // Тормозной путь крейсера ∝ scale превышает ly кадра — режем по BRAKE_LY.
      const distLy = distance / metersPerLy(ship.state.scale)
      if (distLy <= GALAXY_FLIGHT.BRAKE_LY * AUTOPILOT.CRUISE_BRAKE_MARGIN) return false
    } else {
      const cruiseSpeed =
        ship.spec.tuning.MAX_SPEED * CRUISE.MAX_FACTOR * speedScaleFactor(ship.state.scale)
      const brakeDist = cruiseSpeed / CRUISE.DECAY_RATE
      if (distance <= brakeDist * AUTOPILOT.CRUISE_BRAKE_MARGIN) return false
    }

    // Нос уже на цели — иначе сверхсвет уносит боком. Нос корабля смотрит в −Z.
    _toTarget.copy(dest.pos).sub(ship.state.pos)
    const raw = _toTarget.length()
    _nose.set(0, 0, -1).applyQuaternion(ship.state.quat)
    _dir.copy(_toTarget).multiplyScalar(1 / Math.max(raw, 1))
    if (_nose.dot(_dir) < AUTOPILOT.CRUISE_ALIGN) return false

    // В системе — не крейсерить в обход планеты. У галактики тел на луче нет.
    if (!dest.galaxy && aimAround(ship, world, dest.pos, dest.bodyId, _aim)) return false
    return true
  },
}

/** Есть ли куда вести: есть цель в фокусе (или звезда галактики), игрок жив и не пристыкован. */
export function canEngageFlyTo(world: World): boolean {
  if (!world.player.alive || world.docked) return false
  return destination(world) !== null
}

/**
 * Пора ли вернуть штурвал: цель пропала или мы у неё И фактически остановились.
 * Одна дистанция выключала автопилот на полном ходу — особенно заметно на ×scale.
 */
export function flyToArrived(world: World): boolean {
  const dest = destination(world)
  if (!dest) return true
  const closeEnough = dest.galaxy
    ? approachDist(world.player.state.pos, dest) <= 0
    : approachDist(world.player.state.pos, dest) <= AUTOPILOT.ARRIVE_RANGE
  return closeEnough && world.player.state.vel.length() <= AUTOPILOT.PARK_SPEED
}
