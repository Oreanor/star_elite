import { Vector3 } from 'three'
import { AI } from '../../config/ai'
import { GUNNERY } from '../../config/weapons'
import { chanceWithin, clamp, signed } from '../../core/math'
import { shipAxes } from '../flight/axes'
import { isEngageable } from '../combat/engage'
import { isLaser } from '../loadout'
import type { ShipEntity, World } from '../world/entities'
import { breakWaypoint, leadPoint } from './maneuvers'
import { wantsToFlee } from './morale'
import { remember } from './perception'
import { drive, driveOpts } from './steer'
import { pilotTraits } from './traits'
import type { AIMode, AIState } from './types'

/**
 * БОЙ. Поведение `combat` из арбитра: как сблизиться, когда стрелять, когда рвать дистанцию
 * и когда бежать. Рулит через общий слой (`steer.ts`) — здесь только РЕШЕНИЯ.
 *
 * Слабости смоделированы честно:
 *   • решение пересматривается раз в такт размышления — это время реакции;
 *   • прицел дрожит, и дрожание меняется медленно — это рука, а не белый шум;
 *   • разворот ограничен угловым ускорением его же корабля.
 */

/**
 * Горизонт упреждения для СБЛИЖЕНИЯ (кривой погони), не для стрельбы. Условная
 * «скорость снаряда», которой срезается угол при заходе на цель, — крупнее реальной
 * скорости болта: на погоне важно не попасть, а перехватить курс, целясь дальше вперёд.
 *
 * Стрельба ведёт нос иначе — в точку упреждения по НАСТОЯЩЕЙ скорости болта
 * (`GUNNERY.BOLT_SPEED`, см. режим `attack`): лазер теперь снаряд, и по цели, идущей
 * поперёк, без упреждения он ляжет позади неё.
 */
const PURSUIT_HORIZON = 900

/** «Бесконечная» скорость снаряда: луч достаёт мгновенно, упреждать его незачем. */
const INSTANT = 1e9

/**
 * Скорость, под которую считать упреждение, — по тому, ЧЕМ корабль бьёт. Болт летит, луч
 * достаёт сразу: целиться лучом в точку упреждения болта — мазать мимо (этот баг уже ловили,
 * см. CLAUDE.md). На смешанной установке решает то, что даёт больше урона в секунду.
 */
export function aimSpeed(e: ShipEntity): number {
  let beam = 0
  let bolt = 0
  for (const m of e.spec.mounts) {
    const w = m.weapon
    if (!isLaser(w)) continue
    const bore = m.hardpoint.bore ?? 1
    if (w.beam) beam += w.damage * bore
    else bolt += (w.damage / Math.max(w.cooldown, 1e-3)) * bore
  }
  return beam > bolt ? INSTANT : GUNNERY.BOLT_SPEED
}

/** Габарит контейнера для конуса огня — у pod нет hull.radius. Метры. */
const POD_FIRE_RADIUS = 4

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _aim = new Vector3()
const _toTarget = new Vector3()

export function setMode(ai: AIState, mode: AIMode): void {
  if (ai.mode === mode) return
  ai.mode = mode
  ai.modeTimer = 0
}

/**
 * Один такт боя с кораблём-целью. На такте размышления пересматривает режим и пуск ракеты;
 * в остальные — держит принятое решение.
 */
export function fight(e: ShipEntity, ai: AIState, target: ShipEntity, world: World, dt: number, rethink: boolean): void {
  _toTarget.copy(target.state.pos).sub(e.state.pos)
  const distance = _toTarget.length()

  if (rethink) {
    remember(e, target, world.time)
    decideMode(e, ai, target, distance)
    decideMissile(e, ai, world, distance)
  }
  updateAimJitter(e, ai, world, distance, dt)

  let throttle = 1
  switch (ai.mode) {
    case 'patrol':
    case 'pursue':
      // Кривая погони: срезаем угол, целясь туда, где цель окажется.
      leadPoint(e, target, PURSUIT_HORIZON, _aim)
      break
    case 'attack':
      // Болт — снаряд: ведём нос в точку УПРЕЖДЕНИЯ (куда цель придёт за время его полёта);
      // луч достаёт сразу — в саму цель (`aimSpeed`). Дрожание руки добавляется здесь.
      leadPoint(e, target, aimSpeed(e), _aim)
      _aim.add(ai.aimJitter)
      // Медленно: ω = v/d, и на боевой скорости цель не удержать в прицеле.
      throttle = distance > AI.ATTACK_SLOW_RANGE ? AI.ATTACK_THROTTLE_FAR : AI.ATTACK_THROTTLE_NEAR
      break
    case 'break':
    case 'evade':
      _aim.copy(ai.waypoint)
      break
  }

  const escaping = ai.mode === 'break' || ai.mode === 'evade'
  // Рулим В ОБХОД тел на пути (станция между тобой и целью), стреляем — по `_aim`.
  // В атаке нос ведём за целью с учётом её хода поперёк (`aimVel`), в манёврах — по точке.
  drive(e, world, _aim, driveOpts({ throttle, boost: escaping ? AI.ESCAPE_BOOST : 1, separate: false, aimVel: ai.mode === 'attack' ? target.state.vel : null }))

  // Уклонение змейкой: прямолинейный бот — мишень.
  if (escaping) {
    const c = e.controls
    c.pitch = clamp(c.pitch + Math.sin(world.time * 2.6 + ai.phase) * 0.45, -1, 1)
    c.yaw = clamp(c.yaw + Math.cos(world.time * 1.9 + ai.phase) * 0.3, -1, 1)
  }

  // `_aim` в режиме атаки — уже точка упреждения с дрожанием; решение стрелять
  // меряется до неё же, чтобы огонь совпадал с наведением носа.
  if (ai.mode === 'attack' && isEngageable(target) && distance <= AI.FIRE_RANGE) {
    ai.wantsFire = onTarget(e, _aim, target.spec.hull.radius, distance)
  }
}

/** Зовётся только в момент «размышления»: между ними режим держится. */
function decideMode(e: ShipEntity, ai: AIState, target: ShipEntity, distance: number): void {
  // Боевой дух: страх копится из своей слабости, силы врага и робости нрава, а
  // слабость врага его гасит. Перевалил порог — рвёт из боя, а не гибнет героически.
  // Гистерезис держит уже бегущего в бегстве, пока страх не спадёт заметно ниже.
  if (wantsToFlee(e, target, ai.mode === 'evade')) {
    setMode(ai, 'evade')
  } else if (ai.mode === 'break') {
    if (ai.modeTimer > AI.BREAK_TIME) setMode(ai, 'pursue')
  } else if (ai.mode === 'evade') {
    // Страх отпустил (сам оправился или враг ослаб) — возвращается в бой.
    setMode(ai, 'pursue')
  } else if (distance < AI.BREAK_OFF) {
    // Слишком близко: проскок неизбежен, надо разводить, иначе таран.
    setMode(ai, 'break')
    breakWaypoint(e.state, target.state.pos, ai, ai.waypoint)
  } else if (distance < AI.ENGAGE) {
    setMode(ai, 'attack')
  } else {
    setMode(ai, 'pursue')
  }

  if (ai.mode === 'evade' && ai.modeTimer > 2.5) {
    ai.modeTimer = 0
    breakWaypoint(e.state, target.state.pos, ai, ai.waypoint)
  }
}

/**
 * Пуск ракеты. Решение — в такте размышления и не чаще, чем раз в MISSILE_INTERVAL секунд.
 * Шанс считается из ТЕМПА в секундах за длину такта (`chanceWithin`): пилот, думающий реже,
 * бросает кость реже, но каждая кость весомее — итоговый темп от выучки не зависит.
 *
 * Расчётливый бережёт ракету для середины окна: у краёв она либо не наведётся, либо от неё
 * увернутся, и он ждёт, пока цель войдёт в верную дистанцию.
 */
function decideMissile(e: ShipEntity, ai: AIState, world: World, distance: number): void {
  if (ai.mode !== 'attack' || ai.missileCooldown > 0) return
  const min = AI.MISSILE_MIN_RANGE
  const max = AI.MISSILE_MAX_RANGE
  if (distance < min || distance > max) return
  const prudence = pilotTraits(e).prudence
  const margin = (max - min) * 0.25 * prudence
  if (distance < min + margin || distance > max - margin) return
  if (world.rng() >= chanceWithin(AI.MISSILE_RATE, ai.thinkSpan)) return

  ai.wantsMissile = true
  ai.missileCooldown = AI.MISSILE_INTERVAL
}

/**
 * Бить ли по ракете противоракетным импульсом. Решение — ОДНО НА РАКЕТУ: заметил новую в
 * радиусе — один бросок, и он окончателен. Бросок за каждый такт копил бы шанс со временем
 * подлёта, и пилот, думающий чаще, сбивал бы чаще (см. `AI.ECM_CHANCE`). Порог реакции —
 * тот же такт размышления, поэтому идеально вовремя бот не успевает никогда.
 *
 * Ждём, пока ракета подойдёт: `fireEcm` жжёт заряд за каждый подрыв, а издали дешевле
 * увернуться.
 */
export function decideEcm(e: ShipEntity, ai: AIState, world: World): void {
  ai.wantsEcm = false
  if (e.ecmCooldown > 0) return

  for (const m of world.missiles) {
    if (!m.alive || m.ownerId === e.id) continue
    if (m.pos.distanceToSquared(e.state.pos) > AI.ECM_RANGE * AI.ECM_RANGE) continue
    if (m.id <= ai.ecmSeenId) continue
    ai.ecmSeenId = m.id
    if (world.rng() < AI.ECM_CHANCE) {
      ai.wantsEcm = true
      return
    }
  }
}

/** Дрожание прицела обновляется медленно: чаще — получится белый шум, а не рука. */
function updateAimJitter(e: ShipEntity, ai: AIState, world: World, distance: number, dt: number): void {
  ai.aimJitterTimer -= dt
  if (ai.aimJitterTimer > 0) return

  ai.aimJitterTimer = AI.AIM_JITTER_INTERVAL
  // Шире промахивается от слабой выучки и от неточной руки. Ни одно — не от урона.
  const spread = (AI.FIRE_SPREAD * distance * pilotTraits(e).spread) / ai.skill
  const rng = world.rng
  ai.aimJitter.set(signed(rng), signed(rng), signed(rng)).multiplyScalar(spread * 0.5)
}

/**
 * Смотрит ли нос в точку упреждения достаточно точно, чтобы стрелять. Угол меряется до
 * ТОЧКИ УПРЕЖДЕНИЯ, а не до самой цели: иначе бот палит, когда смотрит на цель, а болт
 * уходит в упреждённую точку мимо. Угловой размер цели падает как 1/d — стрелять «примерно
 * туда» издали значит просто греть стволы.
 */
function onTarget(e: ShipEntity, aim: Vector3, radius: number, distance: number): boolean {
  shipAxes(e.state.quat, _fwd, _right, _up)
  _toTarget.copy(aim).sub(e.state.pos).normalize()
  const cone = Math.acos(clamp(_fwd.dot(_toTarget), -1, 1))
  const angularSize = Math.atan2(radius, Math.max(distance, 1))
  return cone < Math.min(AI.FIRE_CONE, angularSize * 2.2)
}

/**
 * Автобой по обломку или астероиду. Тот же шов ShipControls, но цель — точка с
 * радиусом, не корабль: без преследования/ракет, только сближение и лазер.
 * Возвращает false, если цель пропала (тогда ход гашен, `autofightSpent` снимет пилота).
 */
export function fightSoft(e: ShipEntity, ai: AIState, world: World, dt: number, rethink: boolean): boolean {
  const soft = ai.orderedSoft
  if (!soft) return false
  ai.wantsMissile = false
  ai.wantsEcm = false

  let pos: Vector3 | null = null
  let vel: Vector3 | null = null
  let radius = POD_FIRE_RADIUS
  if (soft.kind === 'pod') {
    const pod = world.pods.find((p) => p.id === soft.id && p.alive)
    if (pod) {
      pos = pod.pos
      vel = pod.vel
    }
  } else {
    const rock = world.asteroids.find((a) => a.id === soft.id && a.alive)
    if (rock) {
      pos = rock.pos
      vel = rock.vel
      radius = rock.radius
    }
  }

  if (!pos || !vel) {
    const c = e.controls
    c.throttle = 0
    c.pitch = 0
    c.yaw = 0
    c.roll = 0
    return true
  }

  const distance = pos.distanceTo(e.state.pos)
  if (rethink) setMode(ai, distance < AI.ENGAGE ? 'attack' : 'pursue')
  updateAimJitter(e, ai, world, distance, dt)

  // Упреждение по скорости болта — камень и контейнер тоже движутся.
  const flight = distance / Math.max(aimSpeed(e), 1)
  _aim.copy(pos).addScaledVector(vel, flight).add(ai.aimJitter)

  const throttle =
    ai.mode === 'attack' ? (distance > AI.ATTACK_SLOW_RANGE ? AI.ATTACK_THROTTLE_FAR : AI.ATTACK_THROTTLE_NEAR) : 1
  drive(e, world, _aim, driveOpts({ throttle, separate: false }))

  if (ai.mode === 'attack' && distance <= AI.FIRE_RANGE) ai.wantsFire = onTarget(e, _aim, radius, distance)
  return true
}
