import { Vector3 } from 'three'
import type { LaserEffect } from '../../config/schema'
import { COSMIC } from '../../config/weapons'
import { raySphere } from '../../core/math'
import { bodySizeFactor, bodyZoom } from '../scale/scale'
import { commitFate, markCataclysmHit } from '../world/fates'
import type { BodyEntity, PulseEntity, PulseKind, ShipEntity, WarBaseEntity, World } from '../world/entities'
import { shatterWarBase, warBaseImpactFlash } from './warBase'

/**
 * КОСМИЧЕСКИЕ ЛАЗЕРЫ: импульс жизни и разбивающий импульс. Бьют по НЕБЕСНЫМ телам — планете,
 * луне, звезде; разбивающий шар ещё и сносит ВОЕННУЮ БАЗУ (`shatterWarBase`: очаги по обшивке
 * и общий взрыв). Корабли, станции, камни и ракеты для них прозрачны: это орудие для миров, а
 * не для боя, и сквозь причал луч доходит до планеты за ним.
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
export function castBody(world: World, origin: Vector3, dir: Vector3, range: number, scale = 1): BodyHit {
  _hit.body = null
  _hit.distance = range
  for (const b of world.bodies) {
    if (b.kind === 'station') continue
    // Сфера — та, что видна стрелку этого роста (закон зума): гигант бьёт в нарисованное тело.
    const r = b.radius * bodyZoom(b, scale)
    if (b.pos.distanceToSquared(origin) > (range + r) ** 2) continue
    const t = raySphere(origin, dir, b.pos, r)
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
 * Примет ли тело жизнь: необитаемая твердь каталога. Газ, звезда, живой мир, станция — нет.
 * То же правило, что у применения судьбы (`seedLife`): импульс в неподходящий мир гаснет.
 */
function seedable(body: BodyEntity): boolean {
  return body.kind === 'planet' && susceptible(body) && !body.settlement && body.surface !== 'Газовый гигант'
}

/**
 * Выпустить космический импульс (`kind`: разбивающий шар или импульс жизни). Скорость стрелка
 * импульс НАСЛЕДУЕТ: старт у него медленный (чтобы был виден отрыв), и без этого на ходу
 * корабль обгонял собственный выстрел.
 */
export function spawnPulse(
  world: World,
  shooter: ShipEntity,
  origin: Vector3,
  dir: Vector3,
  range: number,
  radius = COSMIC.PULSE_RADIUS * Math.max(1, shooter.state.scale),
  kind: PulseKind = 'shatter',
): void {
  const scale = Math.max(1, shooter.state.scale)
  world.pulses.push({
    id: world.ids.next(),
    kind,
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
/** Дистанция до попадания в базу (`castWarBase`), м. */
let _baseHit = 0

/** Первая живая военная база на луче ближе `range`; дистанция — в `_baseHit`. */
function castWarBase(world: World, origin: Vector3, dir: Vector3, range: number, scale = 1): WarBaseEntity | null {
  let best: WarBaseEntity | null = null
  _baseHit = range
  for (const b of world.warBases) {
    if (!b.alive) continue
    const t = raySphere(origin, dir, b.pos, b.radius * bodySizeFactor(scale))
    if (t >= 0 && t < _baseHit) {
      _baseHit = t
      best = b
    }
  }
  return best
}

/** Есть ли впереди на остатке пути то, во что импульс может попасть (тело; базы — для шара). */
function aheadOf(world: World, p: PulseEntity): boolean {
  const s = shooterScale(p)
  if (castBody(world, p.pos, _dir, p.distanceLeft, s).body) return true
  return p.kind === 'shatter' && castWarBase(world, p.pos, _dir, p.distanceLeft, s) !== null
}

/**
 * Рост стрелка — по размеру шара (он растёт с бортом, `spawnPulse`): у зеркала стрелок бывает
 * чужим, а шар у всех один и тот же. По нему меряется сфера цели — какой её видит стрелок.
 */
function shooterScale(p: PulseEntity): number {
  return Math.max(1, p.radius / COSMIC.PULSE_RADIUS)
}

/**
 * Полёт импульсов: разгон e^(dt/τ), заметание отрезка шага по телам. Разбивающий: тело
 * каталога — судьба «разбито», военная база — снос; импульс жизни: необитаемая твердь —
 * судьба «жизнь» (базы и прочее ему прозрачны). Судьбу пишет только импульс игрока.
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
    // Впереди пусто до конца дальности — промах: ещё немного полёта и таяние, а не десяток
    // секунд неподвижной точкой на экране. Проверяем, пока промах не признан.
    if (p.missBy === undefined && !aheadOf(world, p)) p.missBy = world.time + COSMIC.PULSE_MISS_LIFE
    if (p.missBy !== undefined && world.time >= p.missBy) {
      list.splice(i, 1)
      continue
    }
    const s = shooterScale(p)
    const hit = castBody(world, p.pos, _dir, step, s)
    const base = p.kind === 'shatter' ? castWarBase(world, p.pos, _dir, hit.distance, s) : null
    if (base) {
      // База ближе тела на пути: шар гаснет в ней, и она рвётся очагами, а потом грохает вся.
      // Сносит хозяин системы — у остальных удар уходит ему, исход придёт от него.
      p.pos.addScaledVector(_dir, _baseHit)
      p.alive = false
      if (world.trafficRole === 'mirror') world.structHits.push({ kind: 'shatter', base: base.slot })
      else shatterWarBase(world, base, p.pos)
      warBaseImpactFlash(world, base, p.pos)
    } else if (hit.body) {
      p.pos.addScaledVector(_dir, hit.distance)
      p.alive = false
      const body = hit.body
      const mine = p.ownerId === world.player.id
      if (p.kind === 'seed') {
        // Жизнь: зрелище и весть даёт сама судьба (`seedLife`) — у всех, кто в системе.
        // В неподходящий мир импульс гаснет искрой.
        if (mine && seedable(body)) commitFate(world, body, 'seed')
        else world.explosions.push({ pos: p.pos.clone(), vel: new Vector3(), born: world.time, scale: p.radius / 8 })
      } else {
        if (mine && susceptible(body) && commitFate(world, body, 'shatter')) markCataclysmHit(world, body, p.pos)
        world.explosions.push({ pos: p.pos.clone(), vel: new Vector3(), born: world.time, scale: p.radius / 4 })
      }
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
 * что копится, с первой же секунды. Отменённый схлопывается за `CHARGE_FIZZLE`; `fizzle =
 * false` — радиус на миг отмены: по нему стоит центр, чтобы шар таял НА МЕСТЕ, а не съезжал
 * к носу (центр — «корпус + радиус», и тающий радиус тянул его назад: с камеры — «вниз»).
 */
export function chargeBallRadius(e: ShipEntity, now: number, fizzle = true): number {
  const c = e.pulseCharge
  if (!c) return 0
  const size = c.kind === 'seed' ? COSMIC.CHARGE_SEED : COSMIC.CHARGE_BALL
  const grown = e.spec.hull.radius * e.state.scale * size * c.level ** 0.6
  if (c.cancelledAt === null || !fizzle) return grown
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

/** Видимая доля импульса: 1 — в деле, к нулю — тает после промаха (`PULSE_FADE` последних секунд). */
export function pulseFade(p: PulseEntity, now: number): number {
  if (p.missBy === undefined) return 1
  return Math.max(0, Math.min(1, (p.missBy - now) / COSMIC.PULSE_FADE))
}
