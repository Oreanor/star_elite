import { Euler, Quaternion, Vector3 } from 'three'
import { ASTEROID, TRAFFIC } from '../../config/world'
import { signed } from '../../core/math'
import type { AsteroidEntity, World } from './entities'

/**
 * Камни как ВСТРЕЧИ, не хардкод-пояс.
 *
 * Одиночка — всегда крупный (верх диапазона). Стая — мельче: делит объём одного
 * крупного на N кусков с сильным разбросом размеров (до стократного), общая
 * «масса» (объём) стаи ≈ одному одиночке.
 */

const _dir = new Vector3()
const _pos = new Vector3()

function randomDir(world: World, out: Vector3): Vector3 {
  do {
    out.set(signed(world.rng), signed(world.rng), signed(world.rng))
  } while (out.lengthSq() < 1e-6)
  return out.normalize()
}

function volOf(r: number): number {
  return r * r * r
}

function radiusOfVol(v: number): number {
  return Math.cbrt(Math.max(v, 1e-9))
}

function aloneRadius(world: World): number {
  // Верхняя половина [MIN..MAX] — одиночка всегда крупнее стайной мелочи.
  const lo = ASTEROID.RADIUS_MIN + (ASTEROID.RADIUS_MAX - ASTEROID.RADIUS_MIN) * 0.5
  return lo + world.rng() * (ASTEROID.RADIUS_MAX - lo)
}

function pushRock(world: World, pos: Vector3, radius: number): AsteroidEntity {
  const r = Math.min(ASTEROID.RADIUS_MAX, Math.max(ASTEROID.RADIUS_MIN, radius))
  const spinScale = r >= ASTEROID.NAV_RADIUS ? 0.04 : 0.12
  const rock: AsteroidEntity = {
    id: world.ids.next(),
    kind: 'asteroid',
    pos: pos.clone(),
    vel: new Vector3(signed(world.rng), signed(world.rng) * 0.3, signed(world.rng)).multiplyScalar(1.3),
    quat: new Quaternion().setFromEuler(new Euler(world.rng() * 6, world.rng() * 6, world.rng() * 6)),
    spin: new Vector3(signed(world.rng), signed(world.rng), signed(world.rng)).multiplyScalar(spinScale),
    radius: r,
    hull: ASTEROID.HULL,
    shape: Math.floor(world.rng() * ASTEROID.SHAPES),
    alive: true,
  }
  world.asteroids.push(rock)
  return rock
}

/** Радиусы стаи: сумма объёмов = totalVol, разброс размеров сильный. */
function packRadii(world: World, count: number, totalVol: number): number[] {
  const weights: number[] = []
  let sum = 0
  for (let i = 0; i < count; i++) {
    // u^POWER: малые u дают крошку, редкий бросок ближе к 1 — крупный кусок.
    const w = Math.pow(Math.max(world.rng(), 1e-6), ASTEROID.PACK_SIZE_POWER)
    weights.push(w)
    sum += w
  }
  const radii = weights.map((w) => radiusOfVol((w / sum) * totalVol))
  // Зажим в диапазон; если срезали — слегка перенормируем объём обратно.
  let vol = 0
  for (let i = 0; i < radii.length; i++) {
    radii[i] = Math.min(ASTEROID.RADIUS_MAX, Math.max(ASTEROID.RADIUS_MIN, radii[i]!))
    vol += volOf(radii[i]!)
  }
  if (vol > 1e-6 && Math.abs(vol - totalVol) / totalVol > 0.05) {
    const k = Math.cbrt(totalVol / vol)
    for (let i = 0; i < radii.length; i++) {
      radii[i] = Math.min(ASTEROID.RADIUS_MAX, Math.max(ASTEROID.RADIUS_MIN, radii[i]! * k))
    }
  }
  return radii
}

function spawnSite(world: World, out: Vector3): void {
  randomDir(world, _dir)
  const distance = TRAFFIC.SPAWN_MIN + world.rng() * (TRAFFIC.SPAWN_MAX - TRAFFIC.SPAWN_MIN)
  out.copy(world.player.state.pos).addScaledVector(_dir, distance)
}

export function liveAsteroidCount(world: World): number {
  let n = 0
  for (const a of world.asteroids) if (a.alive) n++
  return n
}

/** Один крупный камень на кромке радара. */
export function spawnAloneAsteroid(world: World): AsteroidEntity | null {
  if (liveAsteroidCount(world) >= ASTEROID.MAX_LIVE) return null
  spawnSite(world, _pos)
  return pushRock(world, _pos, aloneRadius(world))
}

/**
 * Стая: делит объём одного крупного на N кусков. Мельче одиночки в среднем,
 * но с сильным разбросом размеров.
 */
export function spawnAsteroidPack(world: World): AsteroidEntity[] {
  if (liveAsteroidCount(world) >= ASTEROID.MAX_LIVE) return []
  spawnSite(world, _pos)
  const budgetVol = volOf(aloneRadius(world))
  const n =
    ASTEROID.PACK_MIN + Math.floor(world.rng() * (ASTEROID.PACK_MAX - ASTEROID.PACK_MIN + 1))
  const room = ASTEROID.MAX_LIVE - liveAsteroidCount(world)
  const count = Math.min(n, room)
  if (count < 2) {
    const one = pushRock(world, _pos, aloneRadius(world))
    return [one]
  }
  const radii = packRadii(world, count, budgetVol)
  const born: AsteroidEntity[] = []
  for (let i = 0; i < count; i++) {
    _dir.set(signed(world.rng), signed(world.rng) * 0.4, signed(world.rng))
    if (_dir.lengthSq() < 1e-6) _dir.set(1, 0, 0)
    _dir.normalize().multiplyScalar(world.rng() * ASTEROID.PACK_SPREAD)
    born.push(pushRock(world, _pos.clone().add(_dir), radii[i]!))
  }
  return born
}

/** Встреча с камнями: одиночка или стая. */
export function spawnAsteroidEncounter(world: World): boolean {
  if (liveAsteroidCount(world) >= ASTEROID.MAX_LIVE) return false
  if (world.rng() < ASTEROID.ALONE_CHANCE) return spawnAloneAsteroid(world) != null
  return spawnAsteroidPack(world).length > 0
}

/** Убрать камни за горизонтом радара. Захват / нав / посадка — не трогаем. */
export function despawnDistantAsteroids(world: World): void {
  const limitSq = TRAFFIC.DESPAWN_RANGE * TRAFFIC.DESPAWN_RANGE
  const player = world.player.state.pos
  const landed = world.player.landedOn
  world.asteroids = world.asteroids.filter((a) => {
    if (!a.alive) return false
    if (a.id === world.lockedAsteroidId) return true
    if (a.id === world.navTargetId) return true
    if (landed?.bodyId === a.id) return true
    return a.pos.distanceToSquared(player) <= limitSq
  })
}
