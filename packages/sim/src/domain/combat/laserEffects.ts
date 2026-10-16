import { RAYS } from '../../config/weapons'
import { clamp } from '../../core/math'
import type { LaserEffect } from '../../config/schema'
import type { AsteroidEntity, ShipEntity } from '../world/entities'

/**
 * ЛУЧИ-ПЕРЕДЕЛКИ: что делает с целью луч `shrink` / `grow` / `hold` за `seconds` в луче.
 * Урон — отдельно (у этих лучей его нет); здесь только переделка. Действуют на корабли и
 * камни. Не трогают ни бога (неуязвим), ни чужой кинематический борт (его тело живёт на ЕГО
 * клиенте), ни станции и тела системы — их луч и не находит как цель переделки.
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

export function rayOnAsteroid(a: AsteroidEntity, effect: LaserEffect, rate: number, seconds: number): void {
  const k = scaleFactor(effect, rate, seconds)
  if (k !== 1) {
    // Пределы — от радиуса ДО первого луча: камень нельзя раздувать без конца, перекладывая.
    const base = (a.baseRadius ??= a.radius)
    a.radius = clamp(a.radius * k, base * RAYS.MIN_SCALE, base * RAYS.MAX_SCALE)
  }
  if (effect === 'hold') {
    const damp = Math.exp(-rate * seconds)
    a.vel.multiplyScalar(damp)
    a.spin.multiplyScalar(damp)
  }
}
