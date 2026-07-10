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

/** Радиус куска, который несёт заданную долю объёма исходного камня. */
const radiusForShare = (radius: number, share: number) => radius * Math.cbrt(share)

/** Можно ли расколоть камень дальше, или он уже одна единица груза. */
export const splittable = (a: AsteroidEntity) => a.radius > ASTEROID.MIN_SPLIT_RADIUS

/**
 * Расколоть камень. Осколки делят его объём поровну и разлетаются от центра.
 *
 * Направления разлёта СМЕЩЕНЫ так, чтобы их сумма была нулём. Куски равны по
 * массе, значит центр масс остаётся на месте, а импульс сохраняется точно.
 * Возьми три случайных направления как есть — и каждый выстрел по поясу давал бы
 * ему случайный толчок; за час пояс уехал бы из системы, а сохранение импульса
 * перестало бы быть свойством, которое можно проверить тестом.
 *
 * Неделимый камень превращается в контейнер с рудой — он и был одной единицей.
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

  // Раскол — событие редкое, не горячий путь: массив здесь дешевле, чем два прохода
  // по RNG, которые обязаны выдать одни и те же числа.
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
      // Осколок рождается ближе к поверхности исходного камня, а не в его центре:
      // иначе три куска стартуют внутри друг друга.
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

/** Урон камню. Разваливается — раскалывается, а не исчезает. */
export function damageAsteroid(world: World, a: AsteroidEntity, amount: number): void {
  if (!a.alive) return
  a.hull -= amount
  if (a.hull <= 0) shatter(world, a)
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
