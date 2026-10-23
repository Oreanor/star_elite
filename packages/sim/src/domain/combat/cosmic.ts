import { Vector3 } from 'three'
import type { LaserEffect } from '../../config/schema'
import { COSMIC } from '../../config/weapons'
import { raySphere } from '../../core/math'
import { commitFate } from '../world/fates'
import type { BodyEntity, ShipEntity, World } from '../world/entities'

/**
 * КОСМИЧЕСКИЕ ЛАЗЕРЫ: засевающий луч и разбивающий импульс. Бьют только по НЕБЕСНЫМ телам —
 * планете, луне, звезде. Корабли, станции, военные базы, камни и ракеты для них прозрачны:
 * это орудие для миров, а не для боя, и сквозь причал луч доходит до планеты за ним.
 *
 * Итог попадания — не мутация мира на месте, а правка журнала галактики (`commitFate`):
 * её применяют все клиенты одной дорогой, и разбитое остаётся разбитым для всех.
 */

/** Космический ли эффект — бьёт по мирам, а не по кораблям (и работает у гиганта). */
export function isCosmic(effect: LaserEffect | undefined): boolean {
  return effect === 'seed' || effect === 'shatter'
}

export interface BodyHit {
  body: BodyEntity | null
  distance: number
}

const _hit: BodyHit = { body: null, distance: 0 }

/**
 * Первое небесное тело на луче в пределах `range` (станция — не небесное: сквозь неё).
 * Возвращает модульный объект: копировать, не хранить.
 */
export function castBody(world: World, origin: Vector3, dir: Vector3, range: number): BodyHit {
  _hit.body = null
  _hit.distance = range
  for (const b of world.bodies) {
    if (b.kind === 'station') continue
    if (b.pos.distanceToSquared(origin) > (range + b.radius) ** 2) continue
    const t = raySphere(origin, dir, b.pos, b.radius)
    if (t >= 0 && t < _hit.distance) {
      _hit.distance = t
      _hit.body = b
    }
  }
  return _hit
}

/** Может ли тело принять судьбу: только тела каталога, кроме станций и дыр. */
function susceptible(body: BodyEntity): boolean {
  return body.ref !== undefined && body.kind !== 'station' && body.kind !== 'blackhole'
}

/**
 * Засевающий луч держит мир `seconds`. Набрал `SEED_TIME` — правка галактики «жизнь».
 * Счёт копится тактами луча и забывается, если луч ушёл дольше `SEED_FORGET`: засев —
 * это удержание, а не сумма случайных касаний за вечер. Возвращает длину струи.
 */
export function pourSeed(world: World, shooter: ShipEntity, origin: Vector3, dir: Vector3, range: number, seconds: number): BodyHit {
  const hit = castBody(world, origin, dir, range)
  const body = hit.body
  // Засевает только игрок: правка галактики — поступок пилота, у ботов таких лучей нет.
  if (!body || seconds <= 0 || shooter.id !== world.player.id) return hit
  if (body.kind !== 'planet' || !susceptible(body) || body.settlement || body.surface === 'Газовый гигант') return hit
  const seed = (body.lifeSeed ??= { seconds: 0, lastAt: world.time })
  if (world.time - seed.lastAt > COSMIC.SEED_FORGET) seed.seconds = 0
  seed.lastAt = world.time
  seed.seconds += seconds
  if (seed.seconds >= COSMIC.SEED_TIME) {
    body.lifeSeed = undefined
    commitFate(world, body, 'seed')
  }
  return hit
}

/**
 * Выпустить шар разбивающего лазера. Скорость стрелка шар НАСЛЕДУЕТ: старт у него медленный
 * (чтобы был виден отрыв), и без этого на ходу корабль обгонял собственный выстрел.
 */
export function spawnPulse(
  world: World,
  shooter: ShipEntity,
  origin: Vector3,
  dir: Vector3,
  range: number,
  radius = COSMIC.PULSE_RADIUS * Math.max(1, shooter.state.scale),
): void {
  const scale = Math.max(1, shooter.state.scale)
  world.pulses.push({
    id: world.ids.next(),
    pos: origin.clone(),
    vel: dir.clone().multiplyScalar(COSMIC.PULSE_SPEED0 * scale).add(shooter.state.vel),
    dir: dir.clone(),
    carry: shooter.state.vel.clone(),
    speed: COSMIC.PULSE_SPEED0 * scale,
    ownerId: shooter.id,
    distanceLeft: range,
    radius,
    born: world.time,
    alive: true,
  })
}

const _dir = new Vector3()

/**
 * Полёт шаров: разгон e^(dt/τ), заметание отрезка шага по телам. Попал в тело каталога —
 * судьба «разбито» (от имени игрока); в дыру или тело вне каталога — гаснет вспышкой.
 */
export function stepPulses(world: World, dt: number): void {
  const list = world.pulses
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i]!
    // Свой разгон — вдоль выстрела, поверх унаследованной скорости стрелка.
    p.speed = Math.min(p.speed * Math.exp(dt / COSMIC.PULSE_TAU), COSMIC.PULSE_SPEED_MAX)
    p.vel.copy(p.dir).multiplyScalar(p.speed).add(p.carry)
    const speed = p.vel.length()
    _dir.copy(p.vel).divideScalar(Math.max(speed, 1e-9))
    const step = Math.min(speed * dt, p.distanceLeft)
    const hit = castBody(world, p.pos, _dir, step)
    if (hit.body) {
      p.pos.addScaledVector(_dir, hit.distance)
      p.alive = false
      const body = hit.body
      if (p.ownerId === world.player.id && susceptible(body)) commitFate(world, body, 'shatter')
      world.explosions.push({ pos: p.pos.clone(), vel: new Vector3(), born: world.time, scale: p.radius / 4 })
    } else {
      p.pos.addScaledVector(_dir, step)
      p.distanceLeft -= step
      if (p.distanceLeft <= 0) p.alive = false
    }
    if (!p.alive) list.splice(i, 1)
  }
}

/**
 * Радиус шара заряда, м. Растёт быстро вначале и дотягивает к концу (level^0.6) — видно,
 * что копится, с первой же секунды. Отменённый схлопывается за `CHARGE_FIZZLE`.
 */
export function chargeBallRadius(e: ShipEntity, now: number): number {
  const c = e.pulseCharge
  if (!c) return 0
  const grown = e.spec.hull.radius * e.state.scale * COSMIC.CHARGE_BALL * c.level ** 0.6
  if (c.cancelledAt === null) return grown
  const k = Math.max(0, 1 - (now - c.cancelledAt) / COSMIC.CHARGE_FIZZLE)
  return grown * k * k
}

/**
 * Центр шара: перед носом по линии огня, касаясь корпуса. Одна формула на выстрел и на
 * рендер — шар улетает ровно оттуда, где висел. `pos`/`aim` — поза стрелка (рендер даёт
 * свою, между тактами), `shipRadius`/`ballRadius` — в тех же единицах.
 */
export function chargeBallCenter(pos: Vector3, aim: Vector3, shipRadius: number, ballRadius: number, out: Vector3): Vector3 {
  return out.copy(pos).addScaledVector(aim, shipRadius + ballRadius)
}
