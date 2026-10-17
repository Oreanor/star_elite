import { Quaternion, Vector3 } from 'three'
import { ASTEROID, COMET } from '../../config/world'
import { signed } from '../../core/math'
import { addCommodity, freeCapacity } from '../cargo/hold'
import { COMMODITIES, itemMass } from '../cargo/items'
import type { AsteroidEntity, RockHit, ShipEntity, World } from '../world/entities'
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

/** Можно ли расколоть дальше: мельче MIN_SPLIT или последнее поколение — только в руду. */
export const splittable = (a: AsteroidEntity) =>
  a.radius > ASTEROID.MIN_SPLIT_RADIUS && (a.gen ?? 0) < ASTEROID.SPLIT_MAX_GEN

/**
 * Скорость, которую уносят обломки: у камня — вся его, у кометы — малая доля
 * (`COMET.FRAGMENT_KEEP`): рыхлое ядро взрывается, и пыль гасит импульс о собственный газ.
 * Пишет в `out`; общая для раскола, бомбы и рассыпания в руду.
 */
function fragmentVelocity(a: AsteroidEntity, out: Vector3): Vector3 {
  return out.copy(a.vel).multiplyScalar(a.comet ? COMET.FRAGMENT_KEEP : 1)
}
const _fragVel = new Vector3()

/** Скорость разлёта осколков камня этого радиуса, м/с. */
const splitSpeed = (radius: number) => ASTEROID.SPLIT_SPEED + radius * ASTEROID.SPLIT_SPEED_PER_RADIUS

/**
 * Рассыпать камень в руду: по объёму, но не больше контейнера (остальное — пыль). `oreYield` —
 * КПД ствола, что его рассыпал: военный теряет половину пылью, горный бережёт больше.
 */
function crumble(world: World, a: AsteroidEntity, oreYield = 1): void {
  const units = Math.max(1, Math.round(Math.min(oreUnits(a.radius), ASTEROID.ORE_POD_MAX) * oreYield))
  spawnOrePod(world, a.pos, fragmentVelocity(a, _fragVel), units)
}

/**
 * Расколоть или уничтожить. Крупный → осколки (объём поровну); мелочь ≤ MIN_SPLIT
 * → вспышка и контейнер руды (дальше дробить нечего).
 *
 * Направления разлёта СМЕЩЕНЫ так, чтобы их сумма была нулём. Куски равны по
 * массе, значит центр масс остаётся на месте, а импульс сохраняется точно.
 */
/**
 * Общий камень у не-хозяина не колется здесь: удар уходит хозяину (`world.rockHits`), он
 * расколет и объявит осколки всем. Иначе каждый клиент колол бы по-своему, и пояс у двоих
 * рядом разошёлся бы с первого выстрела. true — удар отправлен, локально ничего не делать.
 */
function forwardRock(world: World, a: AsteroidEntity, damage: number, how: 'laser' | 'bomb' | 'blast' = 'laser', oreYield = 1): boolean {
  if (world.trafficRole !== 'mirror' || !a.netId) return false
  const hit: RockHit = { netId: a.netId, damage }
  if (how === 'bomb') hit.bomb = true
  if (how === 'blast') hit.blast = true
  if (oreYield !== 1) hit.oreYield = oreYield
  world.rockHits.push(hit)
  return true
}

/**
 * Удар ВОЕННОГО лазера: камень не колется, а сразу рассыпается пылью и рудой — без осколков,
 * в отличие от горного (`shatter`). Руды — как у рассыпавшегося (`crumble`, тот же потолок).
 */
export function blastAsteroid(world: World, a: AsteroidEntity, oreYield: number = ASTEROID.BLAST_ORE_YIELD): void {
  if (!a.alive) return
  if (forwardRock(world, a, a.hull + 1, 'blast', oreYield)) return
  a.alive = false
  spawnExplosion(world, a.pos, fragmentVelocity(a, _fragVel), a.radius * 0.12)
  crumble(world, a, oreYield)
}

export function shatter(world: World, a: AsteroidEntity, oreYield = 1): void {
  if (forwardRock(world, a, a.hull + 1, 'laser', oreYield)) return
  a.alive = false
  spawnExplosion(world, a.pos, fragmentVelocity(a, _fragVel), a.radius * 0.12)

  if (!splittable(a)) {
    crumble(world, a, oreYield)
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

  const speed = splitSpeed(a.radius)
  const gen = (a.gen ?? 0) + 1
  for (const dir of dirs) {
    world.asteroids.push({
      id: world.ids.next(),
      kind: 'asteroid',
      pos: a.pos.clone().addScaledVector(dir, a.radius - radius),
      vel: fragmentVelocity(a, new Vector3()).addScaledVector(dir, speed),
      quat: a.quat.clone(),
      spin: new Vector3(signed(rng), signed(rng), signed(rng)).multiplyScalar(0.35),
      radius,
      hull: ASTEROID.HULL,
      shape: Math.floor(rng() * ASTEROID.SHAPES),
      gen,
      alive: true,
    })
  }
}

/** Урон камню. Один импульс лазера (HULL=1) — раскол или уничтожение мелочи. */
export function damageAsteroid(world: World, a: AsteroidEntity, amount: number, oreYield = 1): void {
  if (!a.alive) return
  if (forwardRock(world, a, amount, 'laser', oreYield)) return
  a.hull -= amount
  if (a.hull <= 0) shatter(world, a, oreYield)
}

/**
 * Удар энергобомбы по камню: надвое, радиус `floor(r/2)`.
 * Половинка < MIN_SPLIT (10 м) или сам камень мельче — уничтожение в руду.
 * Один импульс — один раскол (новые куски тем же залпом не трогаем).
 */
export function bombShatterAsteroid(world: World, a: AsteroidEntity): void {
  if (!a.alive) return
  if (forwardRock(world, a, a.hull + 1, 'bomb')) return
  a.alive = false
  spawnExplosion(world, a.pos, fragmentVelocity(a, _fragVel), a.radius * 0.12)

  const half = Math.floor(a.radius / 2)
  const gen = (a.gen ?? 0) + 1
  if (half < ASTEROID.MIN_SPLIT_RADIUS || gen > ASTEROID.SPLIT_MAX_GEN) {
    crumble(world, a)
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
      vel: fragmentVelocity(a, new Vector3()).addScaledVector(dir, splitSpeed(a.radius)),
      quat: a.quat.clone(),
      spin: new Vector3(signed(rng), signed(rng), signed(rng)).multiplyScalar(0.35),
      radius: half,
      hull: ASTEROID.HULL,
      shape: Math.floor(rng() * ASTEROID.SHAPES),
      gen,
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

/**
 * ОБЩИЙ камень из сети: место, скорость и возраст пришли от хозяина; дрейф прямой, поэтому
 * у всех он там же. Вращение — своё (на вид, не на правила).
 */
export function spawnNetRock(
  world: World,
  netId: string,
  pos: Vector3,
  vel: Vector3,
  radius: number,
  shape: number,
  gen = 0,
): AsteroidEntity {
  const a: AsteroidEntity = {
    id: world.ids.next(),
    kind: 'asteroid',
    pos: pos.clone(),
    vel: vel.clone(),
    quat: new Quaternion(),
    spin: new Vector3(0.12, 0.08, 0.05),
    radius,
    hull: ASTEROID.HULL,
    shape,
    gen,
    alive: true,
    netId,
  }
  world.asteroids.push(a)
  return a
}

/** Общий камень расколот или зачерпнут у хозяина — убрать здешнюю копию (со вспышкой, если раскол). */
export function dropNetRock(world: World, netId: string, burst: boolean): void {
  for (const a of world.asteroids) {
    if (a.netId !== netId || !a.alive) continue
    a.alive = false
    if (burst) spawnExplosion(world, a.pos, a.vel, a.radius * 0.12)
  }
}

/** У ХОЗЯИНА: удар по общему камню, присланный другим игроком. Колет как свой. */
export function applyRockHit(world: World, netId: string, damage: number, bomb: boolean, blast = false, oreYield = 1): void {
  const a = world.asteroids.find((x) => x.netId === netId && x.alive)
  if (!a) return
  if (bomb) bombShatterAsteroid(world, a)
  else if (blast) blastAsteroid(world, a, oreYield)
  else damageAsteroid(world, a, damage, oreYield)
}
