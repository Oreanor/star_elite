import { Vector3 } from 'three'
import { AI, PERCEPTION } from '../../config/ai'
import { isEngageable } from '../combat/engage'
import type { BodyEntity, ShipEntity, World } from '../world/entities'

/**
 * ОРГАНЫ ЧУВСТВ бота. Раньше выбор цели читал `world.ships` напрямую: бот знал о каждом в
 * радиусе сквозь планету и терял цель в тот же миг, как она выходила за радиус. Теперь:
 *
 *   • видит по ПРЯМОЙ — тело (планета, луна, станция) загораживает;
 *   • ЧУВСТВУЕТ огонь — того, кто в него попал, знает несколько секунд, даже не видя;
 *   • ПОМНИТ потерянную цель — где видел и куда она шла, и идёт искать.
 *
 * Чистые функции от мира и состояния бота — без своих часов и без случайности.
 */

const _seg = new Vector3()
const _rel = new Vector3()

/** Загораживает ли какое-то тело отрезок a→b. Касательный проход не считается: сфера чуть ужата. */
export function occluded(a: Vector3, b: Vector3, bodies: readonly BodyEntity[]): boolean {
  _seg.copy(b).sub(a)
  const len = _seg.length()
  if (len < 1) return false
  _seg.divideScalar(len)
  for (const body of bodies) {
    const r = body.radius * 0.98
    _rel.copy(body.pos).sub(a)
    const along = _rel.dot(_seg)
    if (along <= 0 || along >= len) continue
    if (_rel.lengthSq() - along * along < r * r) return true
  }
  return false
}

/** Видит ли бот другой борт: в радиусе осведомлённости, не под полем и не за телом. */
export function sees(self: ShipEntity, other: ShipEntity, world: World): boolean {
  if (!isEngageable(other)) return false
  const dSq = other.state.pos.distanceToSquared(self.state.pos)
  if (dSq > AI.AWARENESS * AI.AWARENESS) return false
  return !occluded(self.state.pos, other.state.pos, world.bodies)
}

/**
 * Знает ли бот о борте: видит его — или тот только что в него попал. Под огнём пилот
 * знает направление, откуда стреляют, и стрелок за планетой не становится невидимкой.
 */
export function knowsOf(self: ShipEntity, other: ShipEntity, world: World): boolean {
  if (sees(self, other, world)) return true
  return (
    isEngageable(other) &&
    self.lastAttackerId === other.id &&
    world.time - self.lastHitAt < PERCEPTION.FIRE_AWARE
  )
}

/** Запомнить, где цель сейчас: её место и ход на момент взгляда. */
export function remember(self: ShipEntity, target: ShipEntity, time: number): void {
  const ai = self.ai
  if (!ai) return
  ai.lastSeenId = target.id
  ai.lastSeenPos.copy(target.state.pos)
  ai.lastSeenVel.copy(target.state.vel)
  ai.lastSeenAt = time
}

/** Забыть потерянную цель: искали и не нашли, или искать больше незачем. */
export function forget(self: ShipEntity): void {
  if (self.ai) self.ai.lastSeenId = null
}

/** Свежа ли память о потерянной цели. */
export function memoryFresh(self: ShipEntity, time: number): boolean {
  const ai = self.ai
  return ai != null && ai.lastSeenId != null && time - ai.lastSeenAt < PERCEPTION.MEMORY
}

/**
 * Где искать потерянную цель: последняя известная точка плюс её ход за прошедшее время.
 * Пилот прикидывает, куда она ушла, а не летит туда, где она БЫЛА.
 */
export function searchPoint(self: ShipEntity, time: number, out: Vector3): Vector3 {
  const ai = self.ai!
  return out.copy(ai.lastSeenPos).addScaledVector(ai.lastSeenVel, time - ai.lastSeenAt)
}
