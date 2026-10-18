import { Vector3 } from 'three'
import { ASTEROID, ASTEROID_BELT } from '../../config/world'
import { makeRng } from '../../core/math'
import { pushRock } from './asteroidEncounter'
import type { AsteroidBeltEntity, World } from './entities'

/**
 * Пояса астероидов. Камни пояса — НАСТОЯЩИЕ и неподвижные в поясе: у каждого своё место из
 * зерна (`beltRocks`). Издали рендер рисует их точками; ближе `MATERIALIZE_RANGE` камень
 * становится телом мира на том же месте — его можно сбить, и тогда его нет и точкой.
 *
 * Плоскость пояса — XZ системы, центр — светило (`centerId`), поэтому при сдвиге начала
 * координат пояс едет вместе со звездой сам.
 */

const _rel = new Vector3()

function centerOf(world: World, belt: AsteroidBeltEntity): Vector3 | null {
  return world.bodies.find((b) => b.id === belt.centerId)?.pos ?? null
}

/** Внутри ли точка пояса: по радиусу — в ширине кольца, по высоте — в его толщине. */
export function insideBelt(world: World, belt: AsteroidBeltEntity, pos: Vector3): boolean {
  const c = centerOf(world, belt)
  if (!c) return false
  _rel.copy(pos).sub(c)
  const planar = Math.hypot(_rel.x, _rel.z)
  return Math.abs(planar - belt.radius) <= belt.width / 2 && Math.abs(_rel.y) <= belt.thickness / 2
}

/**
 * Ближайшая к `pos` точка пояса (его объёма) и расстояние до неё, м; 0 — внутри.
 * Для локатора: «пояс там-то, до него столько-то».
 */
export function beltNearest(world: World, belt: AsteroidBeltEntity, pos: Vector3, out: Vector3): number {
  const c = centerOf(world, belt)
  if (!c) return Infinity
  _rel.copy(pos).sub(c)
  const planar = Math.hypot(_rel.x, _rel.z)
  // Направление в плоскости; над самым центром — любое.
  const ux = planar > 1e-6 ? _rel.x / planar : 1
  const uz = planar > 1e-6 ? _rel.z / planar : 0
  const r = Math.min(belt.radius + belt.width / 2, Math.max(belt.radius - belt.width / 2, planar))
  const y = Math.min(belt.thickness / 2, Math.max(-belt.thickness / 2, _rel.y))
  out.set(c.x + ux * r, c.y + y, c.z + uz * r)
  return out.distanceTo(pos)
}

/** Пояс, в котором сейчас точка, или null. */
export function beltAt(world: World, pos: Vector3): AsteroidBeltEntity | null {
  for (const belt of world.asteroidBelts) if (insideBelt(world, belt, pos)) return belt
  return null
}

/** Один камень пояса: место в системе координат пояса (центр — светило) и размер. */
export interface BeltRock {
  /** Смещение от светила, м (плоскость пояса — XZ). */
  x: number
  y: number
  z: number
  radius: number
}

/** Нормальное распределение (Бокс — Мюллер): камни гуще к средней линии пояса. */
function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

const ROCKS_CACHE = new WeakMap<AsteroidBeltEntity, BeltRock[]>()

/**
 * Камни пояса — детерминированно из его размеров (у всех игроков одни и те же). Список
 * чистый и неизменный: держим его на пояс, а не собираем каждый такт.
 */
export function beltRocks(belt: AsteroidBeltEntity): readonly BeltRock[] {
  const cached = ROCKS_CACHE.get(belt)
  if (cached) return cached
  const rng = makeRng(Math.floor(belt.radius) >>> 0)
  const rocks: BeltRock[] = []
  // Скопления: центр — по поясу (гуще к средней линии), камни — вокруг него в `CLUSTER_SPREAD`.
  // Камней на скопление поровну в среднем, но с разбросом: где поле погуще, где пожиже.
  const perCluster = ASTEROID_BELT.ROCKS / ASTEROID_BELT.CLUSTERS
  for (let c = 0; c < ASTEROID_BELT.CLUSTERS && rocks.length < ASTEROID_BELT.ROCKS; c++) {
    const a = rng() * Math.PI * 2
    const r = belt.radius + Math.max(-0.5, Math.min(0.5, gauss(rng) * 0.22)) * belt.width
    const cy = Math.max(-0.5, Math.min(0.5, gauss(rng) * 0.25)) * belt.thickness
    const cx = Math.cos(a) * r
    const cz = Math.sin(a) * r
    const count = Math.max(3, Math.round(perCluster * (0.5 + rng())))
    for (let k = 0; k < count && rocks.length < ASTEROID_BELT.ROCKS; k++) {
      // Плотнее к центру скопления: радиус — квадрат равномерного.
      const u = rng() * 2 - 1
      const phi = rng() * Math.PI * 2
      const ring = Math.sqrt(1 - u * u)
      const d = ASTEROID_BELT.CLUSTER_SPREAD * rng() * rng()
      const size = Math.pow(rng(), ASTEROID_BELT.ROCK_RADIUS_POWER)
      rocks.push({
        x: cx + ring * Math.cos(phi) * d,
        // Поле приплюснуто, как сам пояс.
        y: cy + u * d * 0.4,
        z: cz + ring * Math.sin(phi) * d,
        radius: ASTEROID_BELT.ROCK_RADIUS_MIN + (ASTEROID.RADIUS_MAX - ASTEROID_BELT.ROCK_RADIUS_MIN) * size,
      })
    }
  }
  ROCKS_CACHE.set(belt, rocks)
  return rocks
}

/** Ключ камня: номер пояса в системе и номер камня. */
export function beltRockKey(beltIndex: number, rockIndex: number): string {
  return `${beltIndex}:${rockIndex}`
}

const _rock = new Vector3()

/**
 * Шаг пояса: камни, до которых ближе `MATERIALIZE_RANGE`, становятся телами мира на СВОИХ
 * местах; улетел — тело уберёт обычная уборка (за горизонтом), а камень останется точкой.
 * Сбитый (тело погибло) уходит совсем: ни телом, ни точкой — до следующего входа в систему.
 * Камни ведёт хозяин системы: у зеркала свои не рождаются (как у трафика).
 */
export function stepBelts(world: World, dt: number): void {
  // Судьба уже рождённых: погиб — сбит; пропал из мира живым — улетели, вернётся точкой.
  for (const [key, rock] of world.beltLive) {
    if (!rock.alive) {
      world.beltGone.add(key)
      world.beltLive.delete(key)
    } else if (!world.asteroids.includes(rock)) {
      world.beltLive.delete(key)
    }
  }
  if (world.desolate || world.trafficRole === 'mirror' || world.asteroidBelts.length === 0) return
  world.beltSpawnTimer -= dt
  if (world.beltSpawnTimer > 0) return
  world.beltSpawnTimer = ASTEROID_BELT.SCAN_INTERVAL

  const player = world.player.state.pos
  const range2 = ASTEROID_BELT.MATERIALIZE_RANGE ** 2
  world.asteroidBelts.forEach((belt, b) => {
    const c = centerOf(world, belt)
    if (!c) return
    // Далеко от кольца — камни не перебираем вовсе.
    if (beltNearest(world, belt, player, _rock) > ASTEROID_BELT.MATERIALIZE_RANGE) return
    const rocks = beltRocks(belt)
    for (let i = 0; i < rocks.length; i++) {
      const r = rocks[i]!
      _rock.set(c.x + r.x, c.y + r.y, c.z + r.z)
      if (_rock.distanceToSquared(player) > range2) continue
      const key = beltRockKey(b, i)
      if (world.beltLive.has(key) || world.beltGone.has(key)) continue
      const body = pushRock(world, _rock, r.radius)
      // Камень пояса стоит на своём месте, а не плывёт, как встречный.
      body.vel.set(0, 0, 0)
      body.beltKey = key
      world.beltLive.set(key, body)
    }
  })
}
