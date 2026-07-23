import { Matrix4, Quaternion, Vector3 } from 'three'
import { LANDING } from '../../config/landing'
import { effectiveRadius } from '../scale/scale'
import type {
  AsteroidEntity,
  BodyEntity,
  ScenicRockEntity,
  ShipEntity,
  SurfaceBinding,
  World,
} from '../world/entities'
import type { ShipControls } from './types'
import { shipAxes } from './axes'
import { stepShip } from './model'

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
    landingScaleOk(ship) &&
    isSurfaceLargeEnough(rock.radius, ship)
  )
}

/** Глыба двора — те же ворота размера, что у астероида (к тверди меша). */
export function isLandableScenic(rock: ScenicRockEntity, ship: ShipEntity): boolean {
  return (
    rock.alive &&
    landingScaleOk(ship) &&
    isSurfaceLargeEnough(meshSolidRadius(rock.radius), ship)
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

function scenicRockAsSurface(rock: ScenicRockEntity): LandableSurface {
  return {
    id: rock.id,
    pos: rock.pos,
    // Меш по внешней сфере — твердь глубже, высота стоянки от неё.
    radius: meshSolidRadius(rock.radius),
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
  const scenic = world.scenicRocks.find((r) => r.id === id)
  if (scenic && isLandableScenic(scenic, ship)) return scenicRockAsSurface(scenic)
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
  for (const scenic of world.scenicRocks) {
    if (!isLandableScenic(scenic, ship)) continue
    consider(scenic.id, { pos: scenic.pos, radius: meshSolidRadius(scenic.radius) })
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
  if (!p.alive || p.landedOn || p.autoland !== null) return null
  if (!landingScaleOk(p)) return null

  const prompt = nearestLandableWhere(
    world,
    p,
    (altitude) => altitude <= LANDING.PROMPT_HI && altitude >= LANDING.PROMPT_LO,
  )
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

/** Включить непрерываемую автопосадку игрока на поверхность в окне высот. */
export function armAutoland(world: World): boolean {
  const target = landingPromptTarget(world)
  if (!target) return false
  world.player.autoland = target.id
  return true
}

/** Положить корпус брюхом к нормали (нос в касательной). */
function orientBelly(ship: ShipEntity, normal: Vector3): void {
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
 * Шаг автозахода на ховер. Ведём к HOVER_ALT вдоль нормали; у цели — полёт по сфере.
 * true — этот шаг ведём мы (без гравитации/интегратора).
 */
export function stepAutoland(ship: ShipEntity, world: World, dt: number): boolean {
  if (ship.autoland === null) return false
  if (!landingScaleOk(ship)) {
    ship.autoland = null
    return false
  }
  const surface = findLandable(world, ship.autoland, ship)
  if (!surface) {
    ship.autoland = null
    return false
  }

  _normal.copy(ship.state.pos).sub(surface.pos)
  if (_normal.lengthSq() < 1e-9) _normal.set(0, 1, 0)
  _normal.normalize()

  const altitude = surfaceAltitude(ship, surface)
  const err = altitude - LANDING.HOVER_ALT
  if (Math.abs(err) <= LANDING.HOVER_SNAP) {
    enterSurfaceFlight(ship, surface)
    ship.autoland = null
    return true
  }

  // К цели по нормали: слишком высоко — вниз (−normal), слишком низко — вверх.
  const step = Math.min(LANDING.DESCENT_SPEED * dt, Math.abs(err))
  ship.state.pos.addScaledVector(_normal, err > 0 ? -step : step)
  ship.state.vel.set(0, 0, 0)
  ship.state.angVel.set(0, 0, 0)
  ship.controls.throttle = 0

  // Плавный доворот брюхом к нормали на заходе — дальше пилот крутит сам.
  shipAxes(ship.state.quat, _forward, _right, _up)
  _forward.addScaledVector(_normal, -_forward.dot(_normal))
  if (_forward.lengthSq() < 1e-9) {
    _forward.set(0, 1, 0)
    if (Math.abs(_forward.dot(_normal)) > 0.9) _forward.set(1, 0, 0)
    _forward.addScaledVector(_normal, -_forward.dot(_normal))
  }
  _forward.normalize()
  _right.crossVectors(_forward, _normal).normalize()
  _back.copy(_forward).negate()
  _targetQuat.setFromRotationMatrix(_basis.makeBasis(_right, _normal, _back)).normalize()
  ship.state.quat.slerp(_targetQuat, Math.min(1, LANDING.LEVEL_RATE * dt))

  return true
}

/**
 * Включить ховер: высота HOVER_ALT, дальше полёт по сфере своей физикой.
 * Отрыв — крейсер ≥ ESCAPE_CRUISE или L; скорость сохраняется.
 */
export function enterSurfaceFlight(ship: ShipEntity, surface: LandableSurface): boolean {
  if (!ship.alive) return false

  _normal.copy(ship.state.pos).sub(surface.pos)
  if (_normal.lengthSq() < 1e-9) _normal.set(0, 1, 0)
  _normal.normalize()

  orientBelly(ship, _normal)

  ship.landedOn = { bodyId: surface.id, normal: _normal.clone(), altitude: LANDING.HOVER_ALT }
  ship.state.pos
    .copy(surface.pos)
    .addScaledVector(_normal, surface.radius + effectiveRadius(ship) + LANDING.HOVER_ALT)
  ship.state.vel.set(0, 0, 0)
  ship.state.angVel.set(0, 0, 0)
  ship.controls.throttle = 0
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
  ship.autoland = null
  ship.landedOn = null
  return true
}


/**
 * Набор и снижение в ховере: `strafeUp` (у игрока — Shift+W/S) ведёт САМУ ВЫСОТУ, а не
 * толкает корабль вверх тягой.
 *
 * Так и должно быть в полёте над поверхностью: пилот выбирает эшелон, а рельс сферы его
 * держит. Толкать маневровыми против притяжения значило бы бороться с ним каждую секунду
 * — ровно то, из-за чего низкий полёт превращался в биение о поверхность.
 *
 * Потолок — тот же, с которого прибор перестаёт быть высотомером; пол — чтобы борт не
 * втёрся брюхом в грунт.
 */
function stepHoverAltitude(binding: SurfaceBinding, controls: ShipControls, dt: number): void {
  if (Math.abs(controls.strafeUp) < 1e-3) return
  const next = binding.altitude + controls.strafeUp * LANDING.ALT_RATE * dt
  binding.altitude = Math.min(LANDING.ALT_MAX, Math.max(LANDING.ALT_MIN, next))
}

/**
 * Прижать к сфере ховера: позиция на (R + er + alt), движение — только вдоль поверхности.
 *
 * Радиальную составляющую скорости не ВЫБРАСЫВАЕМ, а КЛАДЁМ в касательную, сохраняя
 * величину. Раньше её просто срезали, и наклон носа съедал ход: пилот целился чуть вниз
 * (естественное движение, когда летишь низко) и терял почти всю тягу — «вперёд лечу
 * плохо». Над поверхностью тяга работает ВДОЛЬ неё, а нос лишь задаёт направление;
 * потерянного хода при этом не появляется и лишнего не берётся.
 */
function constrainToHoverSphere(
  ship: ShipEntity,
  surface: LandableSurface,
  binding: SurfaceBinding,
): void {
  _normal.copy(ship.state.pos).sub(surface.pos)
  if (_normal.lengthSq() < 1e-9) _normal.set(0, 1, 0)
  else _normal.normalize()
  binding.normal.copy(_normal)

  const speed = ship.state.vel.length()
  const vn = ship.state.vel.dot(_normal)
  if (Math.abs(vn) > 1e-12) {
    ship.state.vel.addScaledVector(_normal, -vn)
    const tangential = ship.state.vel.length()
    // Ход строго вверх/вниз касательной не имеет — направлять нечего, гасим.
    if (tangential > 1e-6) ship.state.vel.multiplyScalar(speed / tangential)
  }

  const radius = surface.radius + effectiveRadius(ship) + binding.altitude
  ship.state.pos.copy(surface.pos).addScaledVector(_normal, radius)
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
    ship.state.pos.sub(surface.pos).applyQuaternion(_spinQ).add(surface.pos)
    ship.state.quat.premultiply(_spinQ).normalize()
    ship.state.vel.applyQuaternion(_spinQ)
  }

  /*
   * Корпус ДЕРЖИТ БРЮХО к поверхности всё время полёта, а не только на входе.
   *
   * Иначе тангаж носа уводил из касательной и тягу, и лётный компьютер: тот гасит снос
   * ПОПЕРЁК НОСА, а над поверхностью «поперёк носа» — это как раз ход вдоль неё. Пилот
   * целился чуть вниз (естественное движение на низком полёте) и терял почти всю
   * скорость: «вперёд лечу плохо». Мышь здесь и задумана как взгляд и рыскание — высоту
   * ведут Shift+W/S, так что тангажу в этом режиме уводить корабль из плоскости нечего.
   *
   * Заодно горизонт перестаёт заваливаться, а это ровно то, что делает низкий полёт
   * читаемым: земля внизу, небо вверху, поворот — рысканием.
   */
  stepShip(ship.state, ship.controls, ship.spec.tuning, dt)
  orientBelly(ship, binding.normal)
  stepHoverAltitude(binding, ship.controls, dt)
  constrainToHoverSphere(ship, surface, binding)

  return true
}
