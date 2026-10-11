import { Vector3 } from 'three'
import { shipAxes } from '../flight/axes'
import { interceptPoint } from '../flight/steering'
import type { ShipState } from '../flight/types'
import type { BodyEntity, ShipEntity } from '../world/entities'
import { AI } from '../../config/ai'
import type { AIState } from './types'

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _toTarget = new Vector3()
const _seg = new Vector3()
const _rel = new Vector3()
const _push = new Vector3()
const _WORLD_UP = new Vector3(0, 1, 0)
const _WORLD_X = new Vector3(1, 0, 0)

/**
 * Обойти тело на пути к точке. Если отрезок «корабль → `aim`» проходит сквозь ближайшее
 * тело с запасом (`AI.AVOID_MARGIN`), вместо `aim` отдаётся точка сбоку от тела — на
 * касательной к сфере запаса, со стороны, куда отрезок и так отклонялся. Корабль, уже
 * прижатый к телу, та же точка выводит наружу: она лежит вне сферы.
 *
 * Только руль: решение стрелять меряется до настоящей точки упреждения, а не до обхода —
 * пока огибает станцию, по ней не палит.
 */
/** Радиус сферы запаса вокруг тела: ближе этого бот к нему не правит, м. */
export function avoidClearance(b: BodyEntity): number {
  return b.radius + AI.AVOID_MARGIN + Math.min(b.radius * AI.AVOID_MARGIN_FRAC, AI.AVOID_MARGIN_CAP)
}

/**
 * Тело, внутри которого лежит точка, или null. Такую точку обход не пустит достичь — бот
 * кружил бы у тела вечно; прибытием для неё считается подход к телу (`avoidClearance`).
 */
export function bodyEnclosing(point: Vector3, bodies: readonly BodyEntity[]): BodyEntity | null {
  for (const b of bodies) {
    if (point.distanceToSquared(b.pos) < b.radius * b.radius) return b
  }
  return null
}

export function avoidBodies(pos: Vector3, aim: Vector3, bodies: readonly BodyEntity[], out: Vector3): Vector3 {
  out.copy(aim)
  _seg.copy(aim).sub(pos)
  const len = _seg.length()
  if (len < 1) return out
  _seg.divideScalar(len)

  let hit: BodyEntity | null = null
  let hitAlong = Infinity
  let hitClear = 0
  for (const b of bodies) {
    // Сфера запаса не глотает ни корабль, ни цель: станция у планеты, цель у поверхности —
    // законны. Иначе обход уводил бы прочь от того, к чему летим, а стоящего у тела — вон.
    const clear = Math.max(
      b.radius,
      Math.min(avoidClearance(b), pos.distanceTo(b.pos) * 0.999, aim.distanceTo(b.pos) * 0.999),
    )
    _rel.copy(b.pos).sub(pos)
    const along = _rel.dot(_seg)
    // Позади или дальше цели (с запасом) — не мешает.
    if (along < -clear || along > len + clear) continue
    const perp2 = _rel.lengthSq() - along * along
    if (perp2 >= clear * clear) continue
    if (along < hitAlong) {
      hit = b
      hitAlong = along
      hitClear = clear
    }
  }
  if (!hit) return out

  // Ближайшая к центру тела точка отрезка → направление «прочь от центра» = сторона обхода.
  _push.copy(_seg).multiplyScalar(Math.max(0, hitAlong)).add(pos).sub(hit.pos)
  // Летим ровно в центр — сторону выбираем сами, поперёк курса.
  if (_push.lengthSq() < 1e-6) {
    _push.crossVectors(_seg, _WORLD_UP)
    if (_push.lengthSq() < 1e-6) _push.crossVectors(_seg, _WORLD_X)
  }
  _push.normalize().multiplyScalar(hitClear * 1.2)
  return out.copy(hit.pos).add(_push)
}

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
