import { Vector3 } from 'three'
import { GUNNERY } from '../../config/weapons'
import { raySphere } from '../../core/math'
import type { AsteroidEntity, MissileEntity, ShipEntity, World } from '../world/entities'

/** Что первым встретил луч. Все поля null — луч ушёл в пустоту. */
export interface LaserHit {
  /** Расстояние до попадания. Равно дальности оружия, если попадания нет. */
  distance: number
  ship: ShipEntity | null
  asteroid: AsteroidEntity | null
  missile: MissileEntity | null
}

/**
 * Мгновенный луч против сфер столкновений.
 *
 * Перебор линейный: на сотнях объектов это дешевле, чем поддерживать дерево,
 * которое надо перестраивать каждый кадр — тут всё движется.
 */
export function castLaser(
  world: World,
  origin: Vector3,
  dir: Vector3,
  shooter: ShipEntity,
  range: number,
): LaserHit {
  const hit: LaserHit = { distance: range, ship: null, asteroid: null, missile: null }
  const closer = (t: number): boolean => t >= 0 && t < hit.distance

  // Игрок не может попасть в себя, бот — тоже; но бот может попасть в игрока.
  for (const target of world.ships) {
    if (!target.alive || target === shooter) continue
    const t = raySphere(origin, dir, target.state.pos, target.spec.hull.radius)
    if (closer(t)) {
      hit.distance = t
      hit.ship = target
      hit.asteroid = null
      hit.missile = null
    }
  }
  if (shooter !== world.player && world.player.alive) {
    const t = raySphere(origin, dir, world.player.state.pos, world.player.spec.hull.radius)
    if (closer(t)) {
      hit.distance = t
      hit.ship = world.player
      hit.asteroid = null
      hit.missile = null
    }
  }

  for (const a of world.asteroids) {
    if (!a.alive) continue
    // Дешёвая отбраковка до точного теста: большинство астероидов далеко.
    if (a.pos.distanceToSquared(origin) > (range + a.radius) ** 2) continue
    const t = raySphere(origin, dir, a.pos, a.radius)
    if (closer(t)) {
      hit.distance = t
      hit.ship = null
      hit.asteroid = a
      hit.missile = null
    }
  }

  // Ракету можно сбить — и свою, и чужую. Кроме собственной: она уходит прямо
  // из-под стволов, и первый же залп после пуска сносил бы её сам.
  for (const m of world.missiles) {
    if (!m.alive || m.ownerId === shooter.id) continue
    if (m.pos.distanceToSquared(origin) > (range + GUNNERY.MISSILE_HIT_RADIUS) ** 2) continue
    const t = raySphere(origin, dir, m.pos, GUNNERY.MISSILE_HIT_RADIUS)
    if (closer(t)) {
      hit.distance = t
      hit.ship = null
      hit.asteroid = null
      hit.missile = m
    }
  }

  return hit
}
