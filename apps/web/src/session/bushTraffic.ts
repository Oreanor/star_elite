import { makeRng, slovoAtHome, TRAFFIC, type World } from '@elite/sim'
import { BUSH_TRAFFIC } from './config'
import { torusView } from './torusFlight'

/**
 * ПУТНИКИ КУСТА. Комната-гипертор — дорога между галактиками, и по ней изредка идут чужие
 * корабли, а в отлучке (`slovoAtHome` = нет) — и сам Слово на Святом Духе. Они не трогают
 * мир и не говорят по связи: это попутчики на пути, а не трафик системы.
 *
 * Путник — точка S³ и единичная касательная: летит по БОЛЬШОМУ КРУГУ (геодезическая S³),
 * как и сам игрок, когда гонит решётку носом. Слой рендера проецирует его тем же видом.
 *
 * Шагает в такте (`stepBushTraffic` из `onTick`), темп — в секундах: сколько путников
 * встретишь, не зависит от герцовки монитора.
 */

export interface BushTraveller {
  /** Точка на S³ (единичный 4-вектор). */
  p: Float64Array
  /** Единичная касательная в p — куда летит. */
  t: Float64Array
  /** Угловая скорость по большому кругу, рад/с. */
  speed: number
  /** Сколько ещё лететь, с. Кончилось — уходит. */
  life: number
  god: boolean
  alive: boolean
}

/** Пул фиксированного размера: в такте ничего не выделяется. */
export const bushTravellers: BushTraveller[] = Array.from({ length: BUSH_TRAFFIC.MAX }, () => ({
  p: new Float64Array(4),
  t: new Float64Array(4),
  speed: 0,
  life: 0,
  god: false,
  alive: false,
}))

const rng = makeRng(0x7b05)
let spawnTimer: number = BUSH_TRAFFIC.FIRST_DELAY
const _me = new Float64Array(4)
const _dir = new Float64Array(4)
const _toMe = new Float64Array(4)

/** Комната закрылась — путники остаются по ту сторону, следующий вход начнётся с тишины. */
export function resetBushTraffic(): void {
  for (const b of bushTravellers) b.alive = false
  spawnTimer = BUSH_TRAFFIC.FIRST_DELAY
}

/** Точка игрока на S³: вид V сводит её в (0,0,0,−1), значит p = Vᵀ·(0,0,0,−1). */
export function bushPlayerPoint(out: Float64Array): Float64Array {
  const v = torusView()
  out[0] = -v[12]!
  out[1] = -v[13]!
  out[2] = -v[14]!
  out[3] = -v[15]!
  return out
}

export function stepBushTraffic(world: World, dt: number): void {
  let count = 0
  let godHere = false
  for (const b of bushTravellers) {
    if (!b.alive) continue
    b.life -= dt
    if (b.life <= 0) {
      b.alive = false
      continue
    }
    advance(b, b.speed * dt)
    count++
    if (b.god) godHere = true
  }

  spawnTimer -= dt
  if (spawnTimer > 0) return
  spawnTimer = BUSH_TRAFFIC.SPAWN_INTERVAL * (0.5 + rng())
  if (count >= BUSH_TRAFFIC.MAX) return
  // Бог — изредка и только в отлучке: дома он сидит на Крестах. Та же доля, что в трафике систем.
  const god = !godHere
    && rng() < TRAFFIC.GOD_SHARE
    && !slovoAtHome(world.galaxySeed, world.calendarTime)
  for (const b of bushTravellers) {
    if (b.alive) continue
    spawn(b, god)
    return
  }
}

/** Сдвинуть по большому кругу на угол a: p ← p·cos a + t·sin a, t ← t·cos a − p·sin a. */
function advance(b: BushTraveller, a: number): void {
  const c = Math.cos(a)
  const s = Math.sin(a)
  for (let i = 0; i < 4; i++) {
    const p = b.p[i]!
    const t = b.t[i]!
    b.p[i] = p * c + t * s
    b.t[i] = t * c - p * s
  }
}

/**
 * Родить путника на угловой дальности [SPAWN_MIN, SPAWN_MAX] от игрока, курсом поперёк
 * линии взгляда — так он ПРОЛЕТАЕТ мимо, а не таранит и не уходит прочь, едва появившись.
 */
function spawn(b: BushTraveller, god: boolean): void {
  bushPlayerPoint(_me)
  // Направление от игрока: случайная касательная к S³ в его точке.
  const dir = _dir
  randomTangent(_me, dir)
  const gamma = BUSH_TRAFFIC.SPAWN_MIN_RAD + rng() * (BUSH_TRAFFIC.SPAWN_MAX_RAD - BUSH_TRAFFIC.SPAWN_MIN_RAD)
  const c = Math.cos(gamma)
  const s = Math.sin(gamma)
  for (let i = 0; i < 4; i++) b.p[i] = _me[i]! * c + dir[i]! * s
  // Курс — касательная в p, ортогональная направлению на игрока: идёт мимо.
  randomTangent(b.p, b.t)
  const toMe = _toMe
  for (let i = 0; i < 4; i++) toMe[i] = _me[i]! - b.p[i]! * dot(_me, b.p)
  normalize(toMe)
  removeComponent(b.t, toMe)
  normalize(b.t)
  b.speed = BUSH_TRAFFIC.SPEED_RAD * (0.6 + 0.8 * rng())
  b.life = BUSH_TRAFFIC.LIFE * (0.7 + 0.6 * rng())
  b.god = god
  b.alive = true
}

/** Случайная единичная касательная к S³ в точке p (ортогональна p). */
function randomTangent(p: Float64Array, out: Float64Array): void {
  for (let i = 0; i < 4; i++) out[i] = rng() * 2 - 1
  removeComponent(out, p)
  if (!normalize(out)) {
    out.fill(0)
    out[p[0]! === 0 ? 0 : 1] = 1
    removeComponent(out, p)
    normalize(out)
  }
}

function dot(a: Float64Array, b: Float64Array): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!
}

function removeComponent(v: Float64Array, axis: Float64Array): void {
  const d = dot(v, axis)
  for (let i = 0; i < 4; i++) v[i] = v[i]! - d * axis[i]!
}

function normalize(v: Float64Array): boolean {
  const len = Math.hypot(v[0]!, v[1]!, v[2]!, v[3]!)
  if (len < 1e-9) return false
  for (let i = 0; i < 4; i++) v[i] = v[i]! / len
  return true
}
