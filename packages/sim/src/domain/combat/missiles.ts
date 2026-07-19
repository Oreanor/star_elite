import { Quaternion, Vector3 } from 'three'
import { GUNNERY } from '../../config/weapons'
import { SHIELD } from '../../config/station'
import type { AsteroidEntity, MissileEntity, ShipEntity, World } from '../world/entities'
import { isEngageable } from './engage'
import { breakFromHit } from './breakage'
import { applyDamage } from './damage'
import { spawnExplosion, spawnShieldFlash } from './effects'
import { bombShatterAsteroid } from './mining'

/**
 * Самонаведение — ПРОПОРЦИОНАЛЬНОЕ. Ракета доворачивает вектор скорости со
 * скоростью N·Ω, где Ω — вектор вращения линии визирования. Курс столкновения
 * это в точности Ω = 0: линия визирования не поворачивается, только укорачивается.
 *
 * Раньше ракета доворачивала на ТЕКУЩЕЕ положение цели — чистая погоня. Она
 * всегда отстаёт: по идущей поперёк цели ракета мажет на 15–140 м даже с целым
 * захватом. Замер (`scratch/missiles.ts`): погоня давала 2 попадания из 4, и ни
 * скорость, ни головка не спасали — 850 м/с и та мазала. Пропорциональное
 * наведение попадает 4 из 4 с тех же дистанций, не меняя ни одного числа.
 *
 * От ракеты не уйти манёвром, и это посчитано, а не назначено: её боковое
 * ускорение равно v·ω — при 520 м/с и 1.25 рад/с это семьдесят g против
 * шестнадцати у корабля. Ответ на ракету — ПРО (`fireEcm`), а не вираж.
 *
 * `seekerRate` остаётся пределом слежения: если ракета упирается в свой `turnRate`
 * и перестаёт гасить Ω, линия визирования начинает убегать от головки, и та
 * теряет цель НАВСЕГДА. Тяжёлая ракета с малым turnRate срывается именно так.
 */

const _toTarget = new Vector3()
const _dir = new Vector3()
const _axis = new Vector3()
const _relVel = new Vector3()
/** Вектор вращения линии визирования, рад/с. Направлен по оси доворота. */
const _omega = new Vector3()
const _q = new Quaternion()
/** Локальное «вперёд» модели ракеты. */
const _forward = /* @__PURE__ */ new Vector3(0, 0, -1)

function findTarget(world: World, id: number | null): ShipEntity | null {
  if (id === null) return null
  // Головка теряет цель, поднявшую поле или вошедшую в створ станции:
  // ракета доживает свой срок по прямой.
  if (world.player.id === id) return isEngageable(world.player) ? world.player : null
  const ship = world.ships.find((s) => s.id === id)
  return ship && isEngageable(ship) ? ship : null
}

function findAsteroid(world: World, id: number | null): AsteroidEntity | null {
  if (id === null) return null
  const rock = world.asteroids.find((a) => a.id === id)
  return rock && rock.alive ? rock : null
}

function detonate(world: World, m: MissileEntity, victim: ShipEntity | null): void {
  m.alive = false
  spawnExplosion(world, m.pos, m.vel, 2.2)
  if (victim) {
    const shieldUp = victim.shield > 0 // до удара — им решается поломка (см. breakFromHit)
    applyDamage(victim, m.module.damage, world.time, { kind: 'missile', name: '' })
    if (victim.faction === 'player') breakFromHit(victim, shieldUp, world.rng)
  }
}

/**
 * Погасла ли ракета о защитное поле станции. Станцию не подбить: ракета взрывается о
 * поле (обычным взрывом), а само поле вспыхивает голубым. Проверка точечная — за шаг
 * ракета проходит единицы метров, много меньше радиуса поля, промаха между шагами нет.
 */
function hitStationShield(world: World, m: MissileEntity): boolean {
  for (const b of world.bodies) {
    if (b.kind !== 'station') continue
    const shieldR = b.radius * SHIELD.RADIUS_FACTOR
    if (m.pos.distanceToSquared(b.pos) <= shieldR * shieldR) {
      detonate(world, m, null)
      spawnShieldFlash(world, m.pos, b.pos, 1)
      return true
    }
  }
  return false
}

/**
 * Ракета о камень: тот же раскол, что у энергобомбы (надвое / <10 м уничтожение).
 */
function hitAsteroid(world: World, m: MissileEntity): boolean {
  for (const a of world.asteroids) {
    if (!a.alive) continue
    const r = a.radius + GUNNERY.MISSILE_PROXIMITY
    if (m.pos.distanceToSquared(a.pos) > r * r) continue
    detonate(world, m, null)
    bombShatterAsteroid(world, a)
    return true
  }
  return false
}

/**
 * Угловая скорость линии визирования, рад/с. Это ровно та величина, за которой
 * обязана успевать головка: v⊥ / d.
 */
function lineOfSightRate(
  m: MissileEntity,
  targetVel: Vector3,
  toTargetUnit: Vector3,
  distance: number,
): number {
  _relVel.copy(targetVel).sub(m.vel)
  // Вдоль линии визирования сближение головку не волнует — только поперёк.
  _relVel.addScaledVector(toTargetUnit, -_relVel.dot(toTargetUnit))
  return _relVel.length() / Math.max(distance, 1)
}

/** Доворот вектора скорости на цель (корабль или камень) — пропорциональное наведение. */
function steerAt(
  m: MissileEntity,
  targetPos: Vector3,
  targetVel: Vector3,
  dt: number,
  fuse: number,
): 'hit' | 'lost' | 'ok' {
  _toTarget.copy(targetPos).sub(m.pos)
  const distance = _toTarget.length()
  if (distance < fuse) return 'hit'

  _toTarget.divideScalar(distance)
  if (lineOfSightRate(m, targetVel, _toTarget, distance) > m.module.seekerRate) {
    return 'lost'
  }

  _dir.copy(m.vel).normalize()
  _relVel.copy(targetVel).sub(m.vel)
  _omega.crossVectors(_toTarget, _relVel).divideScalar(distance)
  const rate = _omega.length() * GUNNERY.NAV_CONSTANT
  if (rate > 1e-6) {
    _axis.copy(_omega).normalize()
    _q.setFromAxisAngle(_axis, Math.min(rate, m.module.turnRate) * dt)
    _dir.applyQuaternion(_q)
    m.quat.setFromUnitVectors(_forward, _dir)
  }
  m.vel.copy(_dir).multiplyScalar(m.speed)
  return 'ok'
}

export function stepMissiles(world: World, dt: number): void {
  for (const m of world.missiles) {
    if (!m.alive) continue

    if (world.time - m.born > m.module.lifetime) {
      detonate(world, m, null)
      continue
    }

    const age = world.time - m.born

    // Разгон тяги после схода с пилона.
    if (age < m.module.boostTime) {
      m.speed = Math.min(m.module.speed, m.speed + (m.module.speed / m.module.boostTime) * dt)
    }

    /**
     * Рули включаются по `armTime`, а не по концу разгона. Пока это было одним
     * числом, ракета летела по прямой всю секунду разгона, линия визирования за
     * это время раскручивалась, и головка срывалась на первом же кадре наведения —
     * от Ω, которую ракета накопила сама. Отсчёт срыва обязан начинаться тогда же,
     * когда начинается доворот, иначе головку судят за чужую вину.
     */
    const armed = age >= m.module.armTime
    const shipTarget = armed ? findTarget(world, m.targetId) : null
    const rockTarget = armed && !shipTarget ? findAsteroid(world, m.targetId) : null

    if (shipTarget) {
      const steer = steerAt(m, shipTarget.state.pos, shipTarget.state.vel, dt, GUNNERY.MISSILE_PROXIMITY)
      if (steer === 'hit') {
        detonate(world, m, shipTarget)
        continue
      }
      // Срыв наведения — навсегда. Головка не «моргает»: потеряв цель,
      // она её больше не найдёт, и ракета уходит болванкой.
      if (steer === 'lost') m.targetId = null
    } else if (rockTarget) {
      const fuse = rockTarget.radius + GUNNERY.MISSILE_PROXIMITY
      const steer = steerAt(m, rockTarget.pos, rockTarget.vel, dt, fuse)
      if (steer === 'hit') {
        detonate(world, m, null)
        bombShatterAsteroid(world, rockTarget)
        continue
      }
      if (steer === 'lost') m.targetId = null
    } else if (m.vel.lengthSq() > 1e-6) {
      // Без цели ракета просто летит: скорость меняет только разгон.
      m.vel.setLength(m.speed)
    }

    m.pos.addScaledVector(m.vel, dt)
    if (hitStationShield(world, m)) continue
    hitAsteroid(world, m)
  }

  world.missiles = world.missiles.filter((m) => m.alive)
}
