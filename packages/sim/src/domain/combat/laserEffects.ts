import { Vector3 } from 'three'
import { RAYS } from '../../config/weapons'
import { clamp } from '../../core/math'
import type { LaserEffect } from '../../config/schema'
import type { AsteroidEntity, FigurineEntity, MonolithEntity, RayHold, ShipEntity, TitanEntity, WarBaseEntity, World } from '../world/entities'

function holdMotion(body: { rayHold?: RayHold }, vel: Vector3, angular: Vector3 | undefined, damp: number): void {
  const hold = body.rayHold ??= { touched: false, velocity: new Vector3(), angular: new Vector3() }
  hold.touched = true
  // Возвращаем только снятое лучом: тяга, тяготение и столкновения не теряются при отпускании.
  hold.velocity.addScaledVector(vel, 1 - damp)
  vel.multiplyScalar(damp)
  if (angular) {
    hold.angular.addScaledVector(angular, 1 - damp)
    angular.multiplyScalar(damp)
  }
}

/** Все стволы совместно продлевают удержание на текущий такт. */
export function beginRayHolds(world: World): void {
  if (world.player.rayHold) world.player.rayHold.touched = false
  for (const ship of world.ships) if (ship.rayHold) ship.rayHold.touched = false
  for (const rock of world.asteroids) if (rock.rayHold) rock.rayHold.touched = false
  for (const titan of world.titans) if (titan.rayHold) titan.rayHold.touched = false
}

function releaseMotion(hold: RayHold | undefined, vel: Vector3, angular?: Vector3): void {
  if (!hold || hold.touched) return
  vel.add(hold.velocity)
  angular?.add(hold.angular)
  hold.velocity.set(0, 0, 0)
  hold.angular.set(0, 0, 0)
}

/** Нет попаданий в этом такте — удержание закончено, даже если стрелок погиб или перегрелся. */
export function releaseRayHolds(world: World): void {
  releaseMotion(world.player.rayHold, world.player.state.vel, world.player.state.angVel)
  for (const ship of world.ships) releaseMotion(ship.rayHold, ship.state.vel, ship.state.angVel)
  for (const rock of world.asteroids) releaseMotion(rock.rayHold, rock.vel, rock.spin)
  for (const titan of world.titans) releaseMotion(titan.rayHold, titan.vel)
}

/**
 * ЛУЧИ-ПЕРЕДЕЛКИ: что делает с целью луч `shrink` / `grow` / `hold` за `seconds` в луче.
 * Урон — отдельно (у этих лучей его нет); здесь только переделка. Действуют на корабли,
 * камни, статуи, военные базы и китов. Не трогают ни бога (неуязвим), ни чужой кинематический борт
 * (его тело живёт на ЕГО клиенте), ни станции и тела системы — станция лишь гасит луч щитом,
 * планеты в цели переделки не входят (трафик и орбиты держатся за них).
 *
 * Шаг — экспонента от времени, а не «за попадание»: луч бьёт тиками `BEAM_TICK`, и сила
 * переделки не зависит ни от частоты кадров, ни от длины тика.
 */

/** Множитель масштаба за `seconds`: >1 — растёт, <1 — сжимается, 1 — эффект не про размер. */
function scaleFactor(effect: LaserEffect, rate: number, seconds: number): number {
  if (effect === 'shrink') return Math.exp(-rate * seconds)
  if (effect === 'grow') return Math.exp(rate * seconds)
  return 1
}

/** Длящийся ли эффект (действует, пока цель в луче), а не мгновенный по камню. */
export function isRayEffect(effect: LaserEffect | undefined): boolean {
  return effect === 'shrink' || effect === 'grow' || effect === 'hold'
}

export function rayOnShip(ship: ShipEntity, effect: LaserEffect, rate: number, seconds: number): void {
  if (ship.divine || ship.kinematic) return
  const k = scaleFactor(effect, rate, seconds)
  // Корабль меряем от паспортного размера (масштаб 1): «исходный» борт — заводской.
  if (k !== 1) ship.state.scale = clamp(ship.state.scale * k, RAYS.MIN_SCALE, RAYS.MAX_SCALE)
  if (effect === 'hold') {
    const damp = Math.exp(-rate * seconds)
    holdMotion(ship, ship.state.vel, ship.state.angVel, damp)
  }
}

/**
 * Переделать размер тела с радиусом. Пределы — от радиуса ДО первого луча: тело нельзя
 * раздувать без конца, перекладывая его лучами туда-сюда. Возвращает фактический множитель
 * (с учётом упора) — базе по нему же растут детали.
 */
function resize(body: { radius: number; baseRadius?: number }, k: number): number {
  if (k === 1) return 1
  const base = (body.baseRadius ??= body.radius)
  const before = body.radius
  body.radius = clamp(body.radius * k, base * RAYS.MIN_SCALE, base * RAYS.MAX_SCALE)
  return body.radius / before
}

/**
 * Статуя (монолит у причала, статуэтка на орбите). Только размер: удерживать нечего — она не
 * летает, а её поворот считается от времени (`spin·time`), и тронуть скорость кувырка значит
 * дёрнуть угол скачком.
 */
export function rayOnStatue(statue: MonolithEntity | FigurineEntity, effect: LaserEffect, rate: number, seconds: number): void {
  resize(statue, scaleFactor(effect, rate, seconds))
}

/**
 * Военная база: корпус и ВСЕ навесные детали — одним множителем, так деталь остаётся на своём
 * месте (её точка = радиус базы + размер детали). Удержание — как у статуи, нечего держать.
 */
export function rayOnWarBase(base: WarBaseEntity, effect: LaserEffect, rate: number, seconds: number): void {
  const k = resize(base, scaleFactor(effect, rate, seconds))
  if (k !== 1) for (const f of base.fixtures) f.size *= k
}

/** Кит («Атлас»): размер и дрейф. Его поворот — от времени, крутить нечего, но ход гасится. */
export function rayOnTitan(titan: TitanEntity, effect: LaserEffect, rate: number, seconds: number): void {
  resize(titan, scaleFactor(effect, rate, seconds))
  if (effect === 'hold') holdMotion(titan, titan.vel, undefined, Math.exp(-rate * seconds))
}

export function rayOnAsteroid(a: AsteroidEntity, effect: LaserEffect, rate: number, seconds: number): void {
  resize(a, scaleFactor(effect, rate, seconds))
  if (effect === 'hold') {
    const damp = Math.exp(-rate * seconds)
    holdMotion(a, a.vel, a.spin, damp)
  }
}
