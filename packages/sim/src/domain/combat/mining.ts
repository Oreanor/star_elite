import { Vector3 } from 'three'
import { ASTEROID } from '../../config/world'
import { signed } from '../../core/math'
import { addCommodity, freeCapacity } from '../cargo/hold'
import { COMMODITIES, itemMass } from '../cargo/items'
import type { AsteroidEntity, ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'
import { spawnExplosion } from './effects'
import { spawnOrePod } from './salvage'

/**
 * Добыча. Камень — не мишень, а вещество: у него есть объём, и объём этот
 * сохраняется.
 *
 * Руда считается по КУБУ радиуса. Осколки делят объём поровну, поэтому три куска
 * несут ровно ту же руду, что и целый камень. Считай руду по радиусу линейно —
 * и дробление начнёт рождать вещество из ничего: разбил на три, каждый по 70%
 * радиуса, суммарно вдвое больше исходного.
 */

const _dir = new Vector3()
const _mean = new Vector3()

/** Объём шара. Множитель 4π/3 общий и сокращается, но пусть будет честным. */
const volumeOf = (radius: number) => (4 / 3) * Math.PI * radius ** 3

/** Сколько единиц руды в камне. Минимум единица: пыли в трюме не возят. */
export function oreUnits(radius: number): number {
  return Math.max(1, Math.round(volumeOf(radius) * ASTEROID.ORE_PER_VOLUME))
}

/** Масса камня для физики удара и HUD, т. Потолок на RADIUS_MAX — 1000 т. */
export function asteroidMass(radius: number): number {
  return radius * ASTEROID.MASS_PER_RADIUS
}

/** Радиус куска, который несёт заданную долю объёма исходного камня. */
const radiusForShare = (radius: number, share: number) => radius * Math.cbrt(share)

/** Можно ли расколоть дальше: мельче MIN_SPLIT — только уничтожение. */
export const splittable = (a: AsteroidEntity) => a.radius > ASTEROID.MIN_SPLIT_RADIUS

/**
 * Расколоть или уничтожить. Крупный → осколки (объём поровну); мелочь ≤ MIN_SPLIT
 * → вспышка и контейнер руды (дальше дробить нечего).
 *
 * Направления разлёта СМЕЩЕНЫ так, чтобы их сумма была нулём. Куски равны по
 * массе, значит центр масс остаётся на месте, а импульс сохраняется точно.
 */
export function shatter(world: World, a: AsteroidEntity): void {
  a.alive = false
  spawnExplosion(world, a.pos, a.vel, a.radius * 0.12)

  if (!splittable(a)) {
    spawnOrePod(world, a.pos, a.vel, oreUnits(a.radius))
    return
  }

  const rng = world.rng
  const pieces = ASTEROID.SPLIT_MIN + Math.floor(rng() * (ASTEROID.SPLIT_MAX - ASTEROID.SPLIT_MIN + 1))
  const radius = radiusForShare(a.radius, 1 / pieces)

  const dirs: Vector3[] = []
  _mean.set(0, 0, 0)
  for (let i = 0; i < pieces; i++) {
    _dir.set(signed(rng), signed(rng), signed(rng))
    if (_dir.lengthSq() < 1e-6) _dir.set(1, 0, 0)
    const dir = _dir.clone().normalize()
    dirs.push(dir)
    _mean.add(dir)
  }
  _mean.divideScalar(pieces)
  for (const dir of dirs) dir.sub(_mean)

  for (const dir of dirs) {
    world.asteroids.push({
      id: world.ids.next(),
      kind: 'asteroid',
      pos: a.pos.clone().addScaledVector(dir, a.radius - radius),
      vel: a.vel.clone().addScaledVector(dir, ASTEROID.SPLIT_SPEED),
      quat: a.quat.clone(),
      spin: new Vector3(signed(rng), signed(rng), signed(rng)).multiplyScalar(0.35),
      radius,
      hull: ASTEROID.HULL,
      shape: Math.floor(rng() * ASTEROID.SHAPES),
      alive: true,
    })
  }
}

/** Урон камню. Один импульс лазера (HULL=1) — раскол или уничтожение мелочи. */
export function damageAsteroid(world: World, a: AsteroidEntity, amount: number): void {
  if (!a.alive) return
  a.hull -= amount
  if (a.hull <= 0) shatter(world, a)
}

/**
 * Удар энергобомбы по камню: надвое, радиус `floor(r/2)`.
 * Половинка < MIN_SPLIT (10 м) или сам камень мельче — уничтожение в руду.
 * Один импульс — один раскол (новые куски тем же залпом не трогаем).
 */
export function bombShatterAsteroid(world: World, a: AsteroidEntity): void {
  if (!a.alive) return
  a.alive = false
  spawnExplosion(world, a.pos, a.vel, a.radius * 0.12)

  const half = Math.floor(a.radius / 2)
  if (half < ASTEROID.MIN_SPLIT_RADIUS) {
    spawnOrePod(world, a.pos, a.vel, oreUnits(a.radius))
    return
  }

  const rng = world.rng
  _dir.set(signed(rng), signed(rng), signed(rng))
  if (_dir.lengthSq() < 1e-6) _dir.set(1, 0, 0)
  _dir.normalize()

  for (const sign of [1, -1] as const) {
    const dir = _dir.clone().multiplyScalar(sign)
    world.asteroids.push({
      id: world.ids.next(),
      kind: 'asteroid',
      pos: a.pos.clone().addScaledVector(dir, a.radius - half),
      vel: a.vel.clone().addScaledVector(dir, ASTEROID.SPLIT_SPEED),
      quat: a.quat.clone(),
      spin: new Vector3(signed(rng), signed(rng), signed(rng)).multiplyScalar(0.35),
      radius: half,
      hull: ASTEROID.HULL,
      shape: Math.floor(rng() * ASTEROID.SHAPES),
      alive: true,
    })
  }
}

/** Влезет ли руда этого камня в трюм целиком. */
export function oreFits(ship: ShipEntity, a: AsteroidEntity): boolean {
  return oreUnits(a.radius) * itemMass({ kind: 'commodity', commodity: COMMODITIES.MINERALS, units: 1 }) <=
    freeCapacity(ship.hold)
}

/**
 * Столкновение с камнем: зачерпнуть или расколоть.
 *
 * Мелкий камень уходит в трюм, если там есть место. Крупный — корёжит корпус и
 * раскалывается: решает масса, а не желание пилота. Отказ трюма ничего не меняет
 * в физике удара — камень всё равно бьёт, просто не достаётся.
 *
 * @returns true, если камень зачерпнут и удара не было.
 */
export function scoopAsteroid(ship: ShipEntity, a: AsteroidEntity): boolean {
  if (a.radius > ASTEROID.SCOOP_MAX_RADIUS) return false
  if (!oreFits(ship, a)) return false

  addCommodity(ship.hold, COMMODITIES.MINERALS, oreUnits(a.radius))
  // Груз имеет массу, масса — ускорения. Забыть это значит везти тонны,
  // которых физика не чувствует.
  refreshSpec(ship)
  a.alive = false
  return true
}
