import { Vector3 } from 'three'
import { SHIELD } from '../../config/station'
import { ASTEROID } from '../../config/world'
import type { AsteroidEntity, World } from '../world/entities'
import { spawnExplosion, spawnShieldFlash } from './effects'
import { asteroidMass, shatter } from './mining'

/**
 * Камни и кометы сталкиваются со всем, во что влетают, — честно, как корабли.
 *
 *  - Планета, луна, звезда: удар о поверхность уничтожает камень (у звезды он испаряется).
 *    Чёрная дыра проглатывает его горизонтом.
 *  - Поле станции: отскок со вспышкой — то же поле, что держит корабли.
 *  - Военная база: камень колется о её корпус.
 *  - Камень о камень: быстрее `ASTEROID.IMPACT_SPEED` — оба колются; медленнее — упругий
 *    отскок с учётом масс (стая дрейфует и не должна рассыпаться от соседства).
 *
 * Корабль о камень — в `stepCollisions` (там своя физика корпуса и урона).
 * Общие камни колет только хозяин системы: у зеркала столкновения не считаются, иначе каждый
 * клиент разбил бы пояс по-своему (см. `forwardRock`).
 */

/** Доля нормальной скорости, что остаётся после отскока: камни не мячики. */
const RESTITUTION = 0.5

const _n = new Vector3()
const _contact = new Vector3()
const _zero = new Vector3()
const _sortedRocks: AsteroidEntity[] = []
let sweepAxis: 'x' | 'y' | 'z' = 'x'
const byAxis = (a: AsteroidEntity, b: AsteroidEntity) => a.pos[sweepAxis] - b.pos[sweepAxis]

export function stepRockCollisions(world: World): void {
  if (world.trafficRole === 'mirror') return
  const rocks = world.asteroids
  // Раскол дописывает осколки в конец списка — их в этом такте не трогаем.
  const count = rocks.length
  for (let i = 0; i < count; i++) {
    const a = rocks[i]!
    if (!a.alive) continue
    hitBodies(world, a)
    if (a.alive) hitBases(world, a)
  }
  // В разреженном поясе большинство пар заведомо далеко: отсекаем по одной оси.
  _sortedRocks.length = 0
  let maxRadius = 0
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < count; i++) {
    const a = rocks[i]!
    if (a.alive) {
      _sortedRocks.push(a)
      maxRadius = Math.max(maxRadius, a.radius)
      minX = Math.min(minX, a.pos.x); maxX = Math.max(maxX, a.pos.x)
      minY = Math.min(minY, a.pos.y); maxY = Math.max(maxY, a.pos.y)
      minZ = Math.min(minZ, a.pos.z); maxZ = Math.max(maxZ, a.pos.z)
    }
  }
  // Дуга может идти вдоль любой оси: фиксированный X снова давал бы почти N².
  sweepAxis = maxX - minX >= maxZ - minZ ? 'x' : 'z'
  if (maxY - minY > Math.max(maxX - minX, maxZ - minZ)) sweepAxis = 'y'
  _sortedRocks.sort(byAxis)
  for (let i = 0; i < _sortedRocks.length; i++) {
    const a = _sortedRocks[i]!
    if (!a.alive) continue
    for (let j = i + 1; j < _sortedRocks.length; j++) {
      const b = _sortedRocks[j]!
      if (b.pos[sweepAxis] - a.pos[sweepAxis] > a.radius + maxRadius) break
      if (!b.alive) continue
      rockVsRock(world, a, b)
      if (!a.alive) break
    }
  }
}

function hitBodies(world: World, a: AsteroidEntity): void {
  for (const body of world.bodies) {
    const dist = body.pos.distanceTo(a.pos)
    if (body.kind === 'station') {
      const shieldR = body.radius * SHIELD.RADIUS_FACTOR + a.radius
      if (dist >= shieldR || dist < 1e-6) continue
      _n.copy(a.pos).sub(body.pos).divideScalar(dist)
      const vn = a.vel.dot(_n)
      // Отражаем лишь летящий внутрь: вылетающий не держим, иначе он залипал бы в кромке.
      if (vn < 0) a.vel.addScaledVector(_n, -(1 + RESTITUTION) * vn)
      a.pos.copy(body.pos).addScaledVector(_n, shieldR)
      _contact.copy(body.pos).addScaledVector(_n, body.radius * SHIELD.RADIUS_FACTOR)
      spawnShieldFlash(world, _contact, body.pos, Math.min(1, Math.max(SHIELD.FLASH_MIN_INTENSITY, -vn / SHIELD.FLASH_REF_SPEED)))
      continue
    }
    if (body.kind === 'blackhole') {
      if (dist < body.radius) a.alive = false // за горизонтом — ни вспышки, ни осколков
      continue
    }
    if (dist >= body.radius + a.radius) continue
    // Удар о поверхность: камня больше нет. Руды не остаётся — она на дне кратера или в короне.
    a.alive = false
    _n.copy(a.pos).sub(body.pos).normalize()
    _contact.copy(body.pos).addScaledVector(_n, body.radius)
    if (body.kind !== 'star') spawnExplosion(world, _contact, _zero, a.radius * 0.2)
    return
  }
}

function hitBases(world: World, a: AsteroidEntity): void {
  for (const base of world.warBases) {
    if (!base.alive) continue
    if (base.pos.distanceTo(a.pos) >= base.radius + a.radius) continue
    shatter(world, a)
    return
  }
}

function rockVsRock(world: World, a: AsteroidEntity, b: AsteroidEntity): void {
  const reach = a.radius + b.radius
  const d2 = a.pos.distanceToSquared(b.pos)
  if (d2 >= reach * reach || d2 < 1e-9) return
  const dist = Math.sqrt(d2)
  _n.copy(b.pos).sub(a.pos).divideScalar(dist)
  // Скорость сближения вдоль линии центров: > 0 — сходятся.
  const closing = a.vel.dot(_n) - b.vel.dot(_n)
  if (closing <= 0) return

  if (closing > ASTEROID.IMPACT_SPEED) {
    shatter(world, a)
    shatter(world, b)
    return
  }

  // Упругий (с потерей) отскок: импульс по нормали делится обратно массам.
  const ma = asteroidMass(a.radius)
  const mb = asteroidMass(b.radius)
  const impulse = ((1 + RESTITUTION) * closing) / (1 / ma + 1 / mb)
  a.vel.addScaledVector(_n, -impulse / ma)
  b.vel.addScaledVector(_n, impulse / mb)
  // Развести перекрытие пропорционально массам — тяжёлый сдвигается меньше.
  const overlap = reach - dist
  a.pos.addScaledVector(_n, (-overlap * mb) / (ma + mb))
  b.pos.addScaledVector(_n, (overlap * ma) / (ma + mb))
}
