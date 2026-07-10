import { Vector3 } from 'three'
import { shipAxes } from '../flight/axes'
import { interceptPoint } from '../flight/steering'
import type { ShipState } from '../flight/types'
import type { ShipEntity } from '../world/entities'
import type { AIState } from './types'

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _toTarget = new Vector3()

/**
 * Точка отрыва: вбок и вверх от противника, но ВПЕРЁД по курсу.
 * Уходить назад бессмысленно — развернуться дороже, чем проскочить и разойтись.
 */
export function breakWaypoint(s: ShipState, targetPos: Vector3, ai: AIState, out: Vector3): Vector3 {
  shipAxes(s.quat, _fwd, _right, _up)
  _toTarget.copy(targetPos).sub(s.pos).normalize()

  // Отворачиваем в ту сторону, куда уже наклонён нос: манёвр дешевле по энергии.
  const side = Math.sign(_right.dot(_toTarget)) || 1

  return out
    .copy(s.pos)
    .addScaledVector(_right, -side * 900)
    .addScaledVector(_up, 500 * Math.sin(ai.phase))
    .addScaledVector(_fwd, 700)
}

/**
 * Куда вести нос, чтобы попасть по маневрирующей цели.
 * Скорость «снаряда» условна — она задаёт горизонт упреждения для мгновенного луча.
 */
export function leadPoint(shooter: ShipEntity, target: ShipEntity, projectileSpeed: number, out: Vector3): Vector3 {
  return interceptPoint(
    shooter.state.pos,
    shooter.state.vel,
    target.state.pos,
    target.state.vel,
    projectileSpeed,
    out,
  )
}

/** Патрульная точка: неспешный облёт своего района, у каждого бота своя фаза. */
export function patrolWaypoint(ai: AIState, time: number, out: Vector3): Vector3 {
  const a = time * 0.05 + ai.phase
  return out.set(
    ai.home.x + Math.cos(a) * 700,
    ai.home.y + Math.sin(a * 0.7) * 200,
    ai.home.z + Math.sin(a) * 700,
  )
}
