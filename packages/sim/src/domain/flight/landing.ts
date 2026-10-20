import { Matrix4, Quaternion, Vector3 } from 'three'
import { shiftTrail } from '../world/poseTrail'
import { LANDING } from '../../config/landing'
import { effectiveRadius } from '../scale/scale'
import type {
  AsteroidEntity,
  BodyEntity,
  WarBaseEntity,
  ShipEntity,
  World,
} from '../world/entities'
import { forward, shipAxes } from './axes'
import { stepShip } from './model'

const _climb = new Vector3()
const _normalBefore = new Vector3()
const _spinFrom = new Vector3()
const _noseDir = new Vector3()
const _side = new Vector3()
const _transport = new Quaternion()
const _normal = /* @__PURE__ */ new Vector3()
const _forward = /* @__PURE__ */ new Vector3()
const _right = /* @__PURE__ */ new Vector3()
const _up = /* @__PURE__ */ new Vector3()
const _back = /* @__PURE__ */ new Vector3()
const _basis = /* @__PURE__ */ new Matrix4()
const _targetQuat = /* @__PURE__ */ new Quaternion()
const _spinQ = /* @__PURE__ */ new Quaternion()

/** Поверхность-шар для стоянки: планета, луна, астероид, глыба. Статуи — нет. */
export interface LandableSurface {
  id: number
  pos: Vector3
  radius: number
  /** Собственное вращение тела, рад/с + ось. У астероида — из вектора spin. */
  spinRate: number
  spinAxis: Vector3
}

export function isLandableBody(body: BodyEntity): boolean {
  return body.kind === 'planet' || body.kind === 'moon'
}

/** Миелофон вырос — стоянка выключена (окна высот не масштабируются). */
export function landingScaleOk(ship: ShipEntity): boolean {
  return ship.state.scale <= LANDING.MAX_SHIP_SCALE + 1e-9
}

/** Поверхность достаточно крупная относительно текущего корпуса. */
export function isSurfaceLargeEnough(surfaceRadius: number, ship: ShipEntity): boolean {
  return surfaceRadius >= effectiveRadius(ship) * LANDING.ASTEROID_MIN_SCALE
}

/**
 * Астероид годится для стоянки: жив, борт ≤ 1×, камень ≥ ASTEROID_MIN_SCALE корпусов.
 * Мелочь не «притягивает» — её скуп/таран, не орбитальная стоянка.
 */
export function isLandableAsteroid(rock: AsteroidEntity, ship: ShipEntity): boolean {
  return (
    rock.alive &&
    // Пояс — поток, не стоянка: тысячи камней звали бы ховер и каждый такт мерили высоту.
    rock.beltKey === undefined &&
    landingScaleOk(ship) &&
    isSurfaceLargeEnough(rock.radius, ship)
  )
}

/** Военная база — те же ворота размера, что у астероида, но твердь по гладкому шару. */
export function isLandableWarBase(rock: WarBaseEntity, ship: ShipEntity): boolean {
  return (
    rock.alive &&
    landingScaleOk(ship) &&
    isSurfaceLargeEnough(warBaseSolidRadius(rock.radius), ship)
  )
}

/** @deprecated имя для старых импортов — то же, что `isLandableBody`. */
export const isLandable = isLandableBody

/** Высота корабля над поверхностью, м (габарит борта учтён). Может быть отрицательной. */
export function surfaceAltitude(
  ship: ShipEntity,
  surface: { pos: Vector3; radius: number },
): number {
  return ship.state.pos.distanceTo(surface.pos) - surface.radius - effectiveRadius(ship)
}

function bodyAsSurface(body: BodyEntity): LandableSurface {
  return {
    id: body.id,
    pos: body.pos,
    radius: body.radius,
    spinRate: body.spin,
    spinAxis: body.spinAxis,
  }
}

/** Радиус тверди неровного камня — ближе к текстуре, чем bounding sphere. */
export function meshSolidRadius(radius: number): number {
  return radius * LANDING.MESH_SOLID
}

/** Твердь военной базы. База — гладкий шар (сфера+карта), поэтому солид = сам радиус. */
export function warBaseSolidRadius(radius: number): number {
  return radius * LANDING.WARBASE_SOLID
}

function warBaseAsSurface(rock: WarBaseEntity): LandableSurface {
  return {
    id: rock.id,
    pos: rock.pos,
    // Гладкий шар: твердь совпадает с видимой поверхностью, высота стоянки от неё.
    radius: warBaseSolidRadius(rock.radius),
    spinRate: rock.spin,
    spinAxis: rock.spinAxis,
  }
}

/** Скрэтч для астероида: `spinAxis` переиспользуем, наружу не отдаём. */
const _rockSurface: LandableSurface = {
  id: 0,
  pos: new Vector3(),
  radius: 0,
  spinRate: 0,
  spinAxis: new Vector3(0, 1, 0),
}

function rockIntoSurface(rock: AsteroidEntity, out: LandableSurface): LandableSurface {
  out.id = rock.id
  out.pos = rock.pos
  out.radius = meshSolidRadius(rock.radius)
  out.spinRate = rock.spin.length()
  if (out.spinRate > 1e-9) out.spinAxis.copy(rock.spin).multiplyScalar(1 / out.spinRate)
  else out.spinAxis.set(0, 1, 0)
  return out
}

/** Найти поверхность стоянки по id (шар: тело, астероид, глыба — не статуя). */
export function findLandable(
  world: World,
  id: number,
  ship: ShipEntity,
): LandableSurface | null {
  if (!landingScaleOk(ship)) return null
  const body = world.bodies.find((b) => b.id === id)
  if (body && isLandableBody(body) && isSurfaceLargeEnough(body.radius, ship)) {
    return bodyAsSurface(body)
  }
  const rock = world.asteroids.find((a) => a.id === id)
  if (rock && isLandableAsteroid(rock, ship)) return rockIntoSurface(rock, _rockSurface)
  const warBase = world.warBases.find((r) => r.id === id)
  if (warBase && isLandableWarBase(warBase, ship)) return warBaseAsSurface(warBase)
  return null
}

/**
 * Ближайшая посадочная поверхность среди тех, чья высота проходит `accept`.
 * В густом поясе глыб «просто ближайшая» часто ниже PROMPT_LO и глушила бы окно
 * посадки на соседний камень — поэтому автопосадка фильтрует по окну отдельно.
 */
function nearestLandableWhere(
  world: World,
  ship: ShipEntity,
  accept: (altitude: number) => boolean,
): { id: number; altitude: number } | null {
  let bestId = -1
  let bestAltitude = Infinity

  const consider = (id: number, surface: { pos: Vector3; radius: number }): void => {
    const altitude = surfaceAltitude(ship, surface)
    if (!accept(altitude)) return
    if (altitude < bestAltitude) {
      bestAltitude = altitude
      bestId = id
    }
  }

  if (!landingScaleOk(ship)) return null

  for (const body of world.bodies) {
    if (!isLandableBody(body) || !isSurfaceLargeEnough(body.radius, ship)) continue
    consider(body.id, body)
  }
  for (const rock of world.asteroids) {
    if (!isLandableAsteroid(rock, ship)) continue
    // Высоту меряем до тверди (MESH_SOLID), не до внешней сферы меша.
    consider(rock.id, { pos: rock.pos, radius: meshSolidRadius(rock.radius) })
  }
  // Статуи сознательно не здесь: сложный силуэт, стоянка только над шарами.
  for (const warBase of world.warBases) {
    if (!isLandableWarBase(warBase, ship)) continue
    consider(warBase.id, { pos: warBase.pos, radius: warBaseSolidRadius(warBase.radius) })
  }
  if (bestId < 0) return null
  return { id: bestId, altitude: bestAltitude }
}

/** Ближайшая посадочная поверхность и высота над ней; null — рядом садиться не на что. */
export function nearestLandable(
  world: World,
  ship: ShipEntity,
): { id: number; altitude: number } | null {
  return nearestLandableWhere(world, ship, () => true)
}

/**
 * Поверхность в окне автопосадки (PROMPT_LO…PROMPT_HI). Ближайшая среди подходящих —
 * не среди всех: соседняя глыба в 50 м не должна глушить камень в 150 м.
 */
export function landingPromptTarget(world: World): { id: number; altitude: number } | null {
  const cue = landingCue(world)
  return cue?.phase === 'prompt' ? { id: cue.id, altitude: cue.altitude } : null
}

/**
 * Что показать на HUD у поверхности: подготовка (APPROACH_HI…PROMPT_HI) или «нажми L»
 * (PROMPT_LO…PROMPT_HI). Ближайшая подходящая поверхность — не «просто ближайшая».
 */
export function landingCue(
  world: World,
): { id: number; altitude: number; phase: 'approach' | 'prompt' } | null {
  const p = world.player
  if (!p.alive || p.landedOn) return null
  if (!landingScaleOk(p)) return null

  // Сперва — окно посадки (PROMPT_LO…PROMPT_HI): соседняя глыба внизу не перебивает камень в
  // полосе высот. Нет никого в окне — годится и ниже него: ховер садит на HOVER_ALT (250 м),
  // ниже PROMPT_LO, и после отрыва L иначе не брался бы, пока не поднимешься.
  const prompt =
    nearestLandableWhere(world, p, (altitude) => altitude <= LANDING.PROMPT_HI && altitude >= LANDING.PROMPT_LO) ??
    nearestLandableWhere(world, p, (altitude) => altitude < LANDING.PROMPT_LO && altitude >= 0)
  if (prompt) return { ...prompt, phase: 'prompt' }

  const approach = nearestLandableWhere(
    world,
    p,
    (altitude) => altitude <= LANDING.APPROACH_HI && altitude > LANDING.PROMPT_HI,
  )
  if (approach) return { ...approach, phase: 'approach' }

  return null
}

/**
 * В окне ли высот для автопосадки. Подсказка «нажмите L» и возможность нажать —
 * ровно одновременно; «подготовка» выше по высоте L ещё не даёт.
 */
export function canAutoland(world: World): boolean {
  return landingPromptTarget(world) !== null
}

/**
 * L: сразу в полёт над поверхностью — на той же высоте, с тем же ходом и управлением. Прежде L
 * включал заход: секунду борт выравнивался, стоя на месте, — скорость терялась, руль не слушался.
 * Теперь выравнивание брюхом к грунту — мягкая помощь в первые секунды (`levelFor`).
 */
export function armAutoland(world: World): boolean {
  const target = landingPromptTarget(world)
  if (!target) return false
  const surface = findLandable(world, target.id, world.player)
  if (!surface) return false
  return enterSurfaceFlight(world.player, surface, Math.max(LANDING.ALT_MIN, target.altitude), true)
}

/**
 * ПОСТАВИТЬ борт брюхом к поверхности: нос в касательной, крен нулевой.
 *
 * Зовётся один раз, в момент касания режима (вход в ховер, автозаход): сажают ровно, как
 * на шасси, в какой бы позе борт ни подошёл. Дальше крен принадлежит пилоту и держится
 * шаговым `keepNoseTangent` — там мы его уже не трогаем.
 */
function levelBelly(ship: ShipEntity, normal: Vector3): void {
  shipAxes(ship.state.quat, _forward, _right, _up)
  _forward.addScaledVector(normal, -_forward.dot(normal))
  if (_forward.lengthSq() < 1e-9) {
    _forward.set(0, 1, 0)
    if (Math.abs(_forward.dot(normal)) > 0.9) _forward.set(1, 0, 0)
    _forward.addScaledVector(normal, -_forward.dot(normal))
  }
  _forward.normalize()
  _right.crossVectors(_forward, normal).normalize()
  _back.copy(_forward).negate()
  ship.state.quat.setFromRotationMatrix(_basis.makeBasis(_right, normal, _back)).normalize()
}

/**
 * Поза «брюхом к грунту» для захода: нос — в касательную плоскость, верх — по нормали.
 * Одна на плавный доворот и на проверку «уже выровнен» — иначе они разошлись бы.
 */
function levelTarget(ship: ShipEntity, normal: Vector3, out: Quaternion): Quaternion {
  shipAxes(ship.state.quat, _forward, _right, _up)
  _forward.addScaledVector(normal, -_forward.dot(normal))
  if (_forward.lengthSq() < 1e-9) {
    _forward.set(0, 1, 0)
    if (Math.abs(_forward.dot(normal)) > 0.9) _forward.set(1, 0, 0)
    _forward.addScaledVector(normal, -_forward.dot(normal))
  }
  _forward.normalize()
  _right.crossVectors(_forward, normal).normalize()
  _back.copy(_forward).negate()
  return out.setFromRotationMatrix(_basis.makeBasis(_right, normal, _back)).normalize()
}

/**
 * Включить ховер: высота HOVER_ALT, дальше полёт по сфере своей физикой.
 * Отрыв — крейсер ≥ ESCAPE_CRUISE или L; скорость сохраняется.
 */
export function enterSurfaceFlight(
  ship: ShipEntity,
  surface: LandableSurface,
  altitude: number = LANDING.HOVER_ALT,
  /** Мягкий вход по L: ход, поза и газ — как были, выравнивание — помощью (`levelFor`). */
  soft = false,
): boolean {
  if (!ship.alive) return false

  _normal.copy(ship.state.pos).sub(surface.pos)
  if (_normal.lengthSq() < 1e-9) _normal.set(0, 1, 0)
  _normal.normalize()

  if (!soft) levelBelly(ship, _normal)

  ship.landedOn = { bodyId: surface.id, normal: _normal.clone(), altitude, levelFor: soft ? LANDING.LEVEL_TIME : 0 }
  ship.state.pos
    .copy(surface.pos)
    .addScaledVector(_normal, surface.radius + effectiveRadius(ship) + altitude)
  if (!soft) {
    ship.state.vel.set(0, 0, 0)
    ship.state.angVel.set(0, 0, 0)
    ship.controls.throttle = 0
  }
  ship.controls.retro = 0
  ship.cruise.factor = 1
  ship.cruise.block = null
  ship.cruise.engaged = false
  ship.controls.cruise = 1
  return true
}

/** @deprecated имя — то же, что `enterSurfaceFlight` (ховер, не касание грунта). */
export function landOnSurface(ship: ShipEntity, surface: LandableSurface): boolean {
  return enterSurfaceFlight(ship, surface)
}

/** Ховер над телом мира (планета/луна). */
export function landShip(ship: ShipEntity, body: BodyEntity): boolean {
  if (!isLandableBody(body)) return false
  return enterSurfaceFlight(ship, bodyAsSurface(body))
}

/** Снять ховер. Позу/скорость не трогаем — летишь куда летел; L / ×ESCAPE отпускают. */
export function releaseLanding(ship: ShipEntity, _world: World): boolean {
  if (!ship.landedOn) return false
  ship.landedOn = null
  return true
}


/**
 * Над поверхностью летят как САМОЛЁТ: скорость быстро ложится вдоль носа, величина не теряется.
 * Обычный лётный компьютер гасит снос неспешно (так в космосе и надо), и после рыскания борт
 * долго шёл боком, а камера с упреждением по скорости держала его сбоку от центра кадра.
 * Только с ассистентом: без него — ньютоновский полёт и здесь.
 */
function alignToNose(ship: ShipEntity, dt: number): void {
  if (!ship.controls.flightAssist) return
  const v = ship.state.vel
  const speed = v.length()
  if (speed < 1e-3) return
  forward(ship.state.quat, _noseDir)
  const along = v.dot(_noseDir)
  // Задний ход (нос от скорости) не переворачиваем: гасим лишь поперечное.
  _side.copy(v).addScaledVector(_noseDir, -along)
  v.addScaledVector(_side, -(1 - Math.exp(-LANDING.ALIGN_RATE * dt)))
  const left = v.length()
  if (left > 1e-6) v.multiplyScalar(speed / left)
}

/**
 * Снять с радиального хода `amount` (по нормали), сохранив ВЕЛИЧИНУ скорости: снятое уходит в
 * касательную. Подъём или упор в пол/потолок не крадут ход вдоль поверхности.
 */
function redirectRadial(vel: Vector3, normal: Vector3, amount: number): void {
  const speed = vel.length()
  vel.addScaledVector(normal, -amount)
  const left = vel.length()
  if (left > 1e-6) vel.multiplyScalar(speed / left)
}

/**
 * Ховер по сфере: своя физика (stepShip + рельс по радиусу).
 * true — гравитацию/интегратор снаружи не зовём. false — обычный полёт
 * (нет привязки или только что отпустили на ×ESCAPE).
 */
export function stepLanding(ship: ShipEntity, world: World, dt: number): boolean {
  const binding = ship.landedOn
  if (!binding) return false

  // Вырос миелофоном — отпускаем: дальше обычная физика, не сфера-ховер.
  if (!landingScaleOk(ship)) {
    releaseLanding(ship, world)
    return false
  }

  const surface = findLandable(world, binding.bodyId, ship)
  if (!surface) {
    ship.landedOn = null
    return false
  }

  // До порога — быстрый ховер по сфере; на ×ESCAPE — обычная физика, летишь дальше.
  if (ship.cruise.factor >= LANDING.ESCAPE_CRUISE) {
    releaseLanding(ship, world)
    return false
  }

  // Тело крутится — корабль едет с поверхностью, иначе астероид ускользает из-под ног.
  if (Math.abs(surface.spinRate) > 1e-9) {
    _spinQ.setFromAxisAngle(surface.spinAxis, surface.spinRate * dt)
    _spinFrom.copy(ship.state.pos)
    ship.state.pos.sub(surface.pos).applyQuaternion(_spinQ).add(surface.pos)
    ship.state.quat.premultiply(_spinQ).normalize()
    ship.state.vel.applyQuaternion(_spinQ)
    // Вертикаль под бортом повернулась вместе с телом — иначе шаг ниже довернул бы позу второй раз.
    binding.normal.applyQuaternion(_spinQ)
    /**
     * Езда с поверхностью — СМЕНА СИСТЕМЫ ОТСЧЁТА, а не ход корабля. У планеты экватор идёт
     * сотнями м/с (3.5 м за такт), и камера, не зная об этом, отставала: после L корабль
     * «убегал назад» и почти пропадал, пока разгон не стягивал пружину камеры. Сдвиг идёт
     * камере тем же каналом, что орбитальный перенос, и след позы едет с ним.
     */
    if (ship === world.player) {
      _spinFrom.subVectors(ship.state.pos, _spinFrom)
      world.originShift.add(_spinFrom)
      shiftTrail(ship.state, _spinFrom)
    }
  }

  /*
   * ПОЛЁТ КАК У САМОЛЁТА. Нос ведёт мышь целиком, и тангаж тоже: корабль летит туда, куда
   * смотрит нос, — опустил нос, снижаешься, задрал — набираешь. Высота — СЛЕДСТВИЕ полёта, а
   * не рельс. Прежде корпус держали брюхом к грунту, а тангаж уходил в наклон прицела: лететь
   * носом вверх параллельно поверхности выглядело неправдой, менять высоту можно было лишь
   * Shift+W/S.
   */
  _normalBefore.copy(binding.normal)
  // Shift+W/S здесь двигает эшелон напрямую (ниже), а не тягой маневровых: иначе подъём
  // считался бы дважды — и рельсом, и вертикальной тягой в физике.
  const strafeUp = ship.controls.strafeUp
  ship.controls.strafeUp = 0
  stepShip(ship.state, ship.controls, ship.spec.tuning, dt)
  ship.controls.strafeUp = strafeUp
  /**
   * ВХОД БЕЗ ШВА. Первые секунды после L (`levelFor`) все помощи режима НАРАСТАЮТ от нуля:
   * укладка хода вдоль носа, предел подъёма — иначе на входе скорость разом разворачивалась
   * бы вбок или срезалась. Брюхом к грунту кладём мягко и лишь пока пилот не тянет тангаж/крен.
   */
  const entering = binding.levelFor && binding.levelFor > 0 ? binding.levelFor / LANDING.LEVEL_TIME : 0
  const ease = 1 - entering
  alignToNose(ship, dt * ease)
  if (entering > 0) {
    binding.levelFor = Math.max(0, (binding.levelFor ?? 0) - dt)
    const c = ship.controls
    if (Math.abs(c.pitch) < 0.05 && Math.abs(c.roll) < 0.05) {
      levelTarget(ship, binding.normal, _targetQuat)
      ship.state.quat.slerp(_targetQuat, Math.min(1, LANDING.LEVEL_RATE * dt))
    }
  }

  // Высота — из настоящего места после шага; Shift+W/S по-прежнему поднимает/опускает борт.
  _normal.copy(ship.state.pos).sub(surface.pos)
  if (_normal.lengthSq() < 1e-9) _normal.set(0, 1, 0)
  else _normal.normalize()
  /**
   * Горизонт ЕДЕТ с кораблём. Притяжения в ховере нет, и полёт по прямой уходил бы от
   * искривлённой поверхности: «ровно» над астероидом в километр — это прочь от него за минуту.
   * Самолёт гнёт путь тяготением; здесь — поворотом скорости и позы на тот угол, на который
   * сместилась вертикаль под бортом. Ровный нос держит высоту, меняет её только тангаж.
   */
  _transport.setFromUnitVectors(_normalBefore, _normal)
  ship.state.vel.applyQuaternion(_transport)
  ship.state.quat.premultiply(_transport).normalize()
  binding.normal.copy(_normal)
  const er = effectiveRadius(ship)
  let altitude = ship.state.pos.distanceTo(surface.pos) - surface.radius - er
  const requested = Math.abs(ship.controls.strafeUp) < 1e-3 ? 0 : ship.controls.strafeUp * LANDING.ALT_RATE * dt
  // Shift+W/S — лишь до пола и потолка: у края подъём или спуск кончаются, и камере (ниже)
  // идёт ровно то, что борт РЕАЛЬНО прошёл. Прежде у пола она получала «спуск» и дальше и
  // уезжала от стоящего корабля.
  const railFrom = altitude
  altitude = requested === 0 ? altitude : Math.min(LANDING.ALT_MAX, Math.max(LANDING.ALT_MIN, altitude + requested))
  const climbed = altitude - railFrom

  /**
   * НАБОР ВЫСОТЫ — плавный: носом вверх поднимаешься не быстрее CLIMB_RATE, с форсажем (ПКМ)
   * — CLIMB_RATE_BOOST. Просто так из ховера не улететь: оторваться — разгоном до отрыва
   * (×ESCAPE) или L. Лишний подъём не пропадает, а уходит в ход вдоль поверхности.
   */
  const climbCap = ship.controls.boost > 1 ? LANDING.CLIMB_RATE_BOOST : LANDING.CLIMB_RATE
  const vn = ship.state.vel.dot(_normal)
  // Излишек подъёма уходит в ход вдоль поверхности ПЛАВНО (≈0.25 с), а не одним тактом: влетел
  // в ховер на крутом наборе — нос не дёргает, траектория загибается.
  if (vn > climbCap) redirectRadial(ship.state.vel, _normal, (vn - climbCap) * (1 - Math.exp(-LANDING.ALIGN_RATE * dt)))
  // Потолок и пол: выше ALT_MAX и ниже ALT_MIN не пустим — ход за край гасим, вдоль оставляем.
  if (altitude > LANDING.ALT_MAX || altitude < LANDING.ALT_MIN) {
    altitude = Math.min(LANDING.ALT_MAX, Math.max(LANDING.ALT_MIN, altitude))
    const v = ship.state.vel.dot(_normal)
    if ((altitude >= LANDING.ALT_MAX && v > 0) || (altitude <= LANDING.ALT_MIN && v < 0)) {
      redirectRadial(ship.state.vel, _normal, v)
    }
  }
  binding.altitude = altitude
  ship.state.pos.copy(surface.pos).addScaledVector(_normal, surface.radius + er + altitude)

  /**
   * Подъём Shift+W/S — движение МИРА, а не корабля: камера тянется за бортом пружиной и
   * отстала бы, будто уезжаешь ты, а грунт стоит. Смещение идёт тем же каналом, что
   * перецентровка начала координат, — и след позы едет с ним, без отставания.
   */
  if (requested !== 0 && climbed !== 0 && ship === world.player) {
    world.originShift.addScaledVector(_normal, climbed)
    shiftTrail(ship.state, _climb.copy(_normal).multiplyScalar(climbed))
  }

  // Отпустил газ у поверхности — тормозим ход вдоль сферы к нулю: борт встаёт. Это и есть
  // «сесть, сбросив скорость». С газом коастинг вдоль поверхности остаётся прежним.
  if (Math.abs(ship.controls.throttle) < LANDING.LAND_BRAKE_THROTTLE) {
    ship.state.vel.multiplyScalar(Math.max(0, 1 - LANDING.LAND_BRAKE * dt))
  }

  return true
}
