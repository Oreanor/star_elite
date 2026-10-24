import { Vector3 } from 'three'
import { GALAXY_FLIGHT } from '../../config/galaxy'
import { MIELOPHONE } from '../../config/mielophone'
import { AUTOPILOT } from '../../config/station'
import { PHYSICS } from '../../config/physics'
import { clamp } from '../../core/math'
import type { Controller } from '../sim/controller'
import { apparentRadius, bodySizeFactor, effectiveRadius, jumpStarWorldPos, metersPerLy, speedScaleFactor } from '../scale/scale'
import type { ShipEntity, World } from '../world/entities'
import { findShip, navTarget } from '../world/queries'
import { steerToward } from './steering'
import { lockedAsteroidId, lockedFixtureId, lockedPodId, lockedShipId, softTargetPos } from '../world/queries'

/**
 * Автопилот-НА-ЦЕЛЬ. Третий режим рядом с автостыковкой и автобоем: «лети к тому,
 * что в фокусе» — последний перебор. Tab (`targetFocus: contact`) → захваченный борт;
 * Shift+Tab / карта (`targetFocus: nav`) → нав-тело или статуя; на галактическом
 * масштабе Tab пишет `jumpTargetIndex`; с карты галактики та же метка живёт
 * на любом × — J ведёт туда и в системе (путь через промежуточные звёзды).
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
  // Цель с карты — маршрут на любом ×. Не гасим, пока systemIndex совпал с ближайшей:
  // за пузырём это ещё не «прилетели», J должен вести дальше в BUBBLE_LY.
  if (world.jumpTargetIndex == null) return null
  if (!jumpStarWorldPos(world, _jumpPos)) return null
  const mPerLy = metersPerLy(world.player.state.scale)
  return { pos: _jumpPos, radius: GALAXY_FLIGHT.ARRIVE_LY * mPerLy, bodyId: null, galaxy: true }
}

/**
 * Куда ведём и какой «поверхностный» радиус цели (у борта — 0: точка). null — вести некуда.
 *
 * В системе захват в фокусе (Tab/Shift+Tab) сильнее маршрута с карты: залочил пирата —
 * J ведёт к нему, а не к звезде за световые годы. Гиганту захватов нет — ведёт маршрут.
 */
function destination(world: World): Dest | null {
  if (world.player.state.scale < MIELOPHONE.GHOST_BODY_SCALE) {
    const local = lockDestination(world)
    if (local) return local
  }
  return jumpStarDestination(world)
}

function lockDestination(world: World): Dest | null {
  // Фокус — единственный ответ «куда J»: захваты независимы, иначе пират перебивает планету.
  if (world.targetFocus === 'nav') {
    const nav = navTarget(world)
    if (!nav) return null
    // Автопилот «к планете» означает выйти к ней, а не целиться в центр шара.
    // Сфера 2R оставляет один радиус высоты — достаточно, чтобы штатно погасить ход.
    // Радиус — ВИДИМЫЙ (закон зума): выросший подходит к тому, что видит, а не тормозит за
    // тысячи километров от точки. Пояс — лента точек, его ширина от роста не зависит.
    const scale = world.player.state.scale
    const r = nav.kind === 'belt' ? nav.radius : apparentRadius(nav.radius, nav.kind === 'star', scale)
    return {
      pos: nav.pos,
      radius: r * AUTOPILOT.BODY_STANDOFF_RADII,
      bodyId: nav.id,
      galaxy: false,
    }
  }
  const ship = findShip(world, lockedShipId(world))
  if (ship && ship !== world.player && ship.alive) {
    return { pos: ship.state.pos, radius: 0, bodyId: null, galaxy: false }
  }
  // Контейнер, камень, деталь базы — тот же захват Tab, что и борт: J ведёт и к ним.
  const pod = lockedPodId(world)
  if (pod !== null) return softDest(world, 'pod', pod, 0)
  const rock = lockedAsteroidId(world)
  if (rock !== null) {
    // К камню — до поверхности (видимой), а не в центр глыбы.
    const r = world.asteroids.find((a) => a.id === rock)?.radius ?? 0
    return softDest(world, 'asteroid', rock, r * bodySizeFactor(world.player.state.scale))
  }
  const fixture = lockedFixtureId(world)
  if (fixture !== null) return softDest(world, 'fixture', fixture, 0)
  return null
}

function softDest(world: World, kind: 'pod' | 'asteroid' | 'fixture', id: number, radius: number): Dest | null {
  const pos = softTargetPos(world, { kind, id })
  return pos ? { pos, radius, bodyId: null, galaxy: false } : null
}

/** Дистанция до «зоны прибытия»: у тела — до поверхности, у борта — до центра. */
function approachDist(from: Vector3, dest: { pos: Vector3; radius: number }): number {
  return Math.max(0, from.distanceTo(dest.pos) - dest.radius)
}

/** Состояние одного обхода: ближайшее перекрывающее препятствие вдоль курса. */
let _nearest = Infinity
let _blocked = false

/**
 * Проверить одно препятствие-сферу на луче к цели и, если оно ближе прочих перекрывает курс,
 * увести аим вбок за его зазор. Модульная функция, а не замыкание: обход зовётся каждый кадр.
 */
function avoidSphere(pos: Vector3, dist: number, center: Vector3, radius: number, shipRadius: number, out: Vector3): void {
  // Мельче доли корпуса — не преграда: корпус через неё переступает (`tooSmallToBlock` в такте),
  // и огибать невидимую точку незачем — автопилот вилял бы на пустом месте.
  if (radius < shipRadius * MIELOPHONE.SOLID_MIN_SHARE) return
  _toBody.copy(center).sub(pos)
  const along = _toBody.dot(_dir)
  if (along <= 0 || along >= dist) return // препятствие позади борта или дальше цели
  _closest.copy(pos).addScaledVector(_dir, along) // ближайшая к центру точка луча
  _lateral.copy(_closest).sub(center)
  const lat = _lateral.length()
  // Зазор — не ниже, чем борт уже стоит: внутри зоны обхода (взлёт с орбиты в 500 км)
  // касательный курс планету не задевает, а «обходить» сферу, в которой стоишь, значит
  // вечно сворачивать. Тогда в ответе ближнее настоящее препятствие (станция на пути).
  const hard = radius + shipRadius
  const clearance = Math.max(hard, Math.min(radius * AUTOPILOT.AVOID_CLEARANCE + shipRadius, _toBody.length() - 1))
  if (lat >= clearance || along >= _nearest) return
  _nearest = along
  _blocked = true
  if (lat < 1) {
    // Луч идёт сквозь центр — бокового направления нет, берём любой перпендикуляр курсу.
    _perp.set(0, 1, 0)
    if (Math.abs(_dir.y) > 0.9) _perp.set(1, 0, 0)
    _lateral.copy(_perp).addScaledVector(_dir, -_perp.dot(_dir)).normalize()
  } else {
    _lateral.multiplyScalar(1 / lat)
  }
  // Аим — точка сбоку, вынесенная ЗА зазор: курс идёт мимо, а не сквозь.
  out.copy(center).addScaledVector(_lateral, clearance + AUTOPILOT.AVOID_MARGIN)
}

/**
 * Точка прицеливания в обход тверди. Идём вдоль луча к цели; если препятствие подходит к лучу
 * ближе зазора (радиус×AVOID_CLEARANCE + габарит борта) ДО цели — уводим аим вбок за его
 * сферу, и курс огибает его. Берём БЛИЖАЙШЕЕ перекрывающее; пересчёт каждый кадр сам
 * доворачивает по мере облёта, а как препятствие останется позади — аим возвращается на цель.
 *
 * Препятствия — ВСЯ твердь, а не только тела системы: статуи, статуэтки и военные базы живут
 * своими списками, и прежде автопилот вёл сквозь них — борт упирался в кору, отскок гасил
 * форсаж, автопилот тянул обратно, и корабль висел у статуи с вечным «КРУШЕНИЕМ».
 *
 * Возвращает `true`, если путь перекрыт (аим уведён): по нему `wantsCruise` глушит форсаж —
 * сверхсвет в обход тверди недопустим.
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

  _nearest = Infinity
  _blocked = false
  // Гигант за GHOST_BODY проходит твердь насквозь — обходить нечего.
  if (ship.state.scale >= MIELOPHONE.GHOST_BODY_SCALE) return false
  // Препятствия — того размера, что видны и тверды этому борту (закон зума), и сам борт —
  // в своём росте: выросший не облетает невидимых сфер и не цепляет их своим корпусом.
  const shipR = effectiveRadius(ship)
  const scale = ship.state.scale
  const k = bodySizeFactor(scale)
  for (const body of world.bodies) {
    if (skipBodyId !== null && body.id === skipBodyId) continue // это и есть цель, не препятствие
    avoidSphere(pos, dist, body.pos, apparentRadius(body.radius, body.kind === 'star', scale), shipR, out)
  }
  for (const m of world.monoliths) {
    if (m.id !== skipBodyId) avoidSphere(pos, dist, m.pos, m.radius * k, shipR, out)
  }
  for (const f of world.figurines) {
    if (f.alive && f.id !== skipBodyId) avoidSphere(pos, dist, f.pos, f.radius * k, shipR, out)
  }
  for (const b of world.warBases) {
    if (b.alive && b.id !== skipBodyId) avoidSphere(pos, dist, b.pos, b.radius * k, shipR, out)
  }
  return _blocked
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
  wantsCruise(ship: ShipEntity, world: World): boolean | number {
    const dest = destination(world)
    if (!dest) return false
    const distance = approachDist(ship.state.pos, dest)
    if (distance <= 0) return false

    // В системе — множитель по дистанции (см. AUTOPILOT.CRUISE_APPROACH_RATE). Меньше ×2 —
    // крейсер ни к чему: обычный ход уже подходит, а фаза без столкновений у цели вредна.
    let want: boolean | number = true
    if (dest.galaxy) {
      // Тормозной путь крейсера ∝ scale превышает ly кадра — режем по BRAKE_LY.
      const distLy = distance / metersPerLy(ship.state.scale)
      if (distLy <= GALAXY_FLIGHT.BRAKE_LY * AUTOPILOT.CRUISE_BRAKE_MARGIN) return false
    } else {
      const top = ship.spec.tuning.MAX_SPEED * speedScaleFactor(ship.state.scale)
      const factor = Math.min(ship.spec.cruiseMax, (distance * AUTOPILOT.CRUISE_APPROACH_RATE) / Math.max(top, 1))
      if (factor < 2) return false
      // Разгон — обычный экспоненциальный (true), а дойдя до нужного — защёлка: множитель
      // стоит и тает вместе с дистанцией, поэтому подход сам замедляется к цели.
      want = ship.cruise.factor < factor ? true : factor
    }

    // Нос уже на цели — иначе сверхсвет уносит боком. Нос корабля смотрит в −Z.
    _toTarget.copy(dest.pos).sub(ship.state.pos)
    const raw = _toTarget.length()
    _nose.set(0, 0, -1).applyQuaternion(ship.state.quat)
    _dir.copy(_toTarget).multiplyScalar(1 / Math.max(raw, 1))
    if (_nose.dot(_dir) < AUTOPILOT.CRUISE_ALIGN) return false

    // В системе — не крейсерить в обход планеты. У галактики тел на луче нет.
    if (!dest.galaxy && aimAround(ship, world, dest.pos, dest.bodyId, _aim)) return false
    return want
  },
}

/** Есть ли куда вести: есть цель в фокусе (или звезда галактики), игрок жив и не пристыкован. */
/**
 * Есть ли цель В СИСТЕМЕ (захват Tab / Shift+Tab): она сильнее маршрута с карты. Нет — J ведёт
 * к звезде с карты; второй пилот туда не ползёт, а прыгает (`copilotJumpRoute`).
 */
export function flyToLocalTarget(world: World): boolean {
  return world.player.state.scale < MIELOPHONE.GHOST_BODY_SCALE && lockDestination(world) !== null
}

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
