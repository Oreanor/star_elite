import { Vector3 } from 'three'
import { GUNNERY } from '../../config/weapons'
import { SHIELD } from '../../config/station'
import { raySphere } from '../../core/math'
import type { AsteroidEntity, BodyEntity, MissileEntity, PlatformEntity, ShipEntity, World } from '../world/entities'

/** Что первым встретил луч. Все поля null — луч ушёл в пустоту. */
export interface LaserHit {
  /** Расстояние до попадания. Равно дальности оружия, если попадания нет. */
  distance: number
  ship: ShipEntity | null
  asteroid: AsteroidEntity | null
  missile: MissileEntity | null
  platform: PlatformEntity | null
  /** Станция, о ЩИТ которой погас луч. Урона не наносит — станция неуязвима. */
  station: BodyEntity | null
}

/**
 * Кто стреляет — с точки зрения луча. Раньше сюда шёл весь `ShipEntity`, но лучу
 * нужны лишь две вещи: чей это выстрел (не задеть стрелка) и был ли он из-под
 * маскировки. Лёгкий контекст позволяет тем же лучом заметать лазерный БОЛТ,
 * чей стрелок к моменту попадания мог уже погибнуть. `ShipEntity` подходит под
 * этот тип структурно, поэтому старые вызовы менять не нужно.
 */
export interface ShotSource {
  id: number
  cloaked: boolean
}

/**
 * Луч против сфер столкновений: находит ПЕРВОЕ пересечение в пределах `range`.
 * Зовётся и мгновенным лучом (на всю дальность), и болтом (на длину шага —
 * заметание отрезка, пройденного за 1/120 с).
 *
 * Перебор линейный: на сотнях объектов это дешевле, чем поддерживать дерево,
 * которое надо перестраивать каждый кадр — тут всё движется.
 */
export function castLaser(
  world: World,
  origin: Vector3,
  dir: Vector3,
  shooter: ShotSource,
  range: number,
): LaserHit {
  const hit: LaserHit = { distance: range, ship: null, asteroid: null, missile: null, platform: null, station: null }
  const closer = (t: number): boolean => t >= 0 && t < hit.distance
  const set = (t: number, next: Partial<LaserHit>): void => {
    hit.distance = t
    hit.ship = next.ship ?? null
    hit.asteroid = next.asteroid ?? null
    hit.missile = next.missile ?? null
    hit.platform = next.platform ?? null
    hit.station = next.station ?? null
  }

  /**
   * Замаскированный стрелок бьёт ТОЛЬКО по спящему гнезду — спящим пиратам и самой
   * платформе. Живого бодрствующего под полем задеть нельзя: маскировка осталась
   * побегом, а не безнаказанностью. Ниже это гасит и корабли, и астероиды с ракетами.
   */
  const cloaked = shooter.cloaked

  // Игрок не может попасть в себя, бот — тоже; но бот может попасть в игрока.
  // Сверяем по id, а не по ссылке: болт хранит id владельца, а не сам объект.
  for (const target of world.ships) {
    if (!target.alive || target.id === shooter.id) continue
    /**
     * БОГ (Слово) для луча не существует. Он сидит В станции у каждого причала и физическим
     * телом не является: иначе стрельба у причала била бы в невидимку — болт съедался, а по
     * кинематическому борту ещё и уходил `remoteHits`, будто это удалённый игрок.
     */
    if (target.divine) continue
    if (cloaked && !target.ai?.dormant) continue
    // Дешёвая отбраковка до точного теста, как у астероидов/ракет: болт заметает
    // отрезок в 1/120 с (~200 м), большинство кораблей дальше — их не проверяем лучом.
    if (target.state.pos.distanceToSquared(origin) > (range + target.spec.hull.radius) ** 2) continue
    const t = raySphere(origin, dir, target.state.pos, target.spec.hull.radius)
    if (closer(t)) set(t, { ship: target })
  }
  if (!cloaked && shooter.id !== world.player.id && world.player.alive) {
    if (world.player.state.pos.distanceToSquared(origin) <= (range + world.player.spec.hull.radius) ** 2) {
      const t = raySphere(origin, dir, world.player.state.pos, world.player.spec.hull.radius)
      if (closer(t)) set(t, { ship: world.player })
    }
  }

  // Платформа-гнездо: её ядро — цель для луча, и под полем тоже (гнездо от этого
  // не проснётся, пока платформа не взорвётся). Радиус — ядро корпуса, не силуэт.
  for (const p of world.platforms) {
    if (!p.alive) continue
    if (p.pos.distanceToSquared(origin) > (range + p.radius) ** 2) continue
    const t = raySphere(origin, dir, p.pos, p.radius)
    if (closer(t)) set(t, { platform: p })
  }

  // Щит станции: снаряд гаснет о поле у поверхности. Это не «цель», а стенка, и станция
  // неуязвима — урона нет. Тест независим от маскировки: поле ловит любой физический болт,
  // из-под клоака в том числе (маскировка прячет от прицела, а не проходит сквозь металл).
  for (const b of world.bodies) {
    if (b.kind !== 'station') continue
    const shieldR = b.radius * SHIELD.RADIUS_FACTOR
    if (b.pos.distanceToSquared(origin) > (range + shieldR) ** 2) continue
    const t = raySphere(origin, dir, b.pos, shieldR)
    if (closer(t)) set(t, { station: b })
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
