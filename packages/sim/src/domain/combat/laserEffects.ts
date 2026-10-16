import { RAYS } from '../../config/weapons'
import { clamp } from '../../core/math'
import type { LaserEffect } from '../../config/schema'
import type { AsteroidEntity, FigurineEntity, MonolithEntity, ShipEntity, WarBaseEntity } from '../world/entities'

/**
 * ЛУЧИ-ПЕРЕДЕЛКИ: что делает с целью луч `shrink` / `grow` / `hold` за `seconds` в луче.
 * Урон — отдельно (у этих лучей его нет); здесь только переделка. Действуют на корабли,
 * камни, статуи и военные базы. Не трогают ни бога (неуязвим), ни чужой кинематический борт
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
    ship.state.vel.multiplyScalar(damp)
    ship.state.angVel.multiplyScalar(damp)
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

export function rayOnAsteroid(a: AsteroidEntity, effect: LaserEffect, rate: number, seconds: number): void {
  resize(a, scaleFactor(effect, rate, seconds))
  if (effect === 'hold') {
    const damp = Math.exp(-rate * seconds)
    a.vel.multiplyScalar(damp)
    a.spin.multiplyScalar(damp)
  }
}
