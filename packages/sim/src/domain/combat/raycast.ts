import { Vector3 } from 'three'
import { GUNNERY } from '../../config/weapons'
import { raySphere } from '../../core/math'
import type { AsteroidEntity, MissileEntity, PlatformEntity, ShipEntity, World } from '../world/entities'

/** Что первым встретил луч. Все поля null — луч ушёл в пустоту. */
export interface LaserHit {
  /** Расстояние до попадания. Равно дальности оружия, если попадания нет. */
  distance: number
  ship: ShipEntity | null
  asteroid: AsteroidEntity | null
  missile: MissileEntity | null
  platform: PlatformEntity | null
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
  const hit: LaserHit = { distance: range, ship: null, asteroid: null, missile: null, platform: null }
  const closer = (t: number): boolean => t >= 0 && t < hit.distance
  const set = (t: number, next: Partial<LaserHit>): void => {
    hit.distance = t
    hit.ship = next.ship ?? null
    hit.asteroid = next.asteroid ?? null
    hit.missile = next.missile ?? null
    hit.platform = next.platform ?? null
  }

  /**
   * Замаскированный стрелок бьёт ТОЛЬКО по спящему гнезду — спящим пиратам и самой
   * платформе. Живого бодрствующего под полем задеть нельзя: маскировка осталась
   * побегом, а не безнаказанностью. Ниже это гасит и корабли, и астероиды с ракетами.
   */
  const cloaked = shooter.cloaked

  // Игрок не может попасть в себя, бот — тоже; но бот может попасть в игрока.
  for (const target of world.ships) {
    if (!target.alive || target === shooter) continue
    if (cloaked && !target.ai?.dormant) continue
    const t = raySphere(origin, dir, target.state.pos, target.spec.hull.radius)
    if (closer(t)) set(t, { ship: target })
  }
  if (!cloaked && shooter !== world.player && world.player.alive) {
    const t = raySphere(origin, dir, world.player.state.pos, world.player.spec.hull.radius)
    if (closer(t)) set(t, { ship: world.player })
  }

  // Платформа-гнездо: её ядро — цель для луча, и под полем тоже (гнездо от этого
  // не проснётся, пока платформа не взорвётся). Радиус — ядро корпуса, не силуэт.
  for (const p of world.platforms) {
    if (!p.alive) continue
    if (p.pos.distanceToSquared(origin) > (range + p.radius) ** 2) continue
    const t = raySphere(origin, dir, p.pos, p.radius)
    if (closer(t)) set(t, { platform: p })
  }

  // Астероиды и ракеты замаскированному не цель: под полем режем и их.
  if (!cloaked) {
    for (const a of world.asteroids) {
      if (!a.alive) continue
      // Дешёвая отбраковка до точного теста: большинство астероидов далеко.
      if (a.pos.distanceToSquared(origin) > (range + a.radius) ** 2) continue
      const t = raySphere(origin, dir, a.pos, a.radius)
      if (closer(t)) set(t, { asteroid: a })
    }

    // Ракету можно сбить — и свою, и чужую. Кроме собственной: она уходит прямо
    // из-под стволов, и первый же залп после пуска сносил бы её сам.
    for (const m of world.missiles) {
      if (!m.alive || m.ownerId === shooter.id) continue
      if (m.pos.distanceToSquared(origin) > (range + GUNNERY.MISSILE_HIT_RADIUS) ** 2) continue
      const t = raySphere(origin, dir, m.pos, GUNNERY.MISSILE_HIT_RADIUS)
      if (closer(t)) set(t, { missile: m })
    }
  }

  return hit
}
