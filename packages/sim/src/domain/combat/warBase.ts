import { Quaternion, Vector3 } from 'three'
import { MONOLITH } from '../../config/monoliths'
import { WARBASE } from '../../config/warbase'
import type { WarBaseEntity, WarBaseFixture, World } from '../world/entities'
import { spawnExplosion } from './effects'
import { spawnRockDebrisPod } from './salvage'

/** База не дрейфует — вспышка гибели без унаследованной скорости. */
const _still = /* @__PURE__ */ new Vector3()
const _spin = /* @__PURE__ */ new Quaternion()
const _fixWorld = /* @__PURE__ */ new Vector3()

/**
 * Мировая точка навесной детали в момент `time`: локальная радиаль, повёрнутая спином базы,
 * отложенная на поверхность + выступ. ОДИН источник для луча и рендера — куда нарисовано,
 * туда и попадает. Пишет в `out`, наружу scratch не отдаёт.
 */
export function warBaseFixtureWorldPos(base: WarBaseEntity, fix: WarBaseFixture, time: number, out: Vector3): Vector3 {
  _spin.setFromAxisAngle(base.spinAxis, base.spin * time)
  out.copy(fix.dir).applyQuaternion(_spin)
  const reach = base.radius + fix.size * WARBASE.FIXTURE_SIT_OUT
  return out.multiplyScalar(reach).add(base.pos)
}

/** Сколько осколков сыплется с базы: крупнее — гуще. */
function debrisCount(radius: number): number {
  const span = MONOLITH.ROCK_RADIUS_MAX - MONOLITH.ROCK_RADIUS_MIN
  const t = span > 1e-6 ? (radius - MONOLITH.ROCK_RADIUS_MIN) / span : 0
  return (
    MONOLITH.ROCK_DEBRIS_MIN +
    Math.round(Math.min(1, Math.max(0, t)) * (MONOLITH.ROCK_DEBRIS_MAX - MONOLITH.ROCK_DEBRIS_MIN))
  )
}

/** Взорвать базу и оставить подбираемые осколки с массой. */
export function destroyWarBase(world: World, base: WarBaseEntity): void {
  base.alive = false
  spawnExplosion(world, base.pos, _still, base.radius * MONOLITH.ROCK_BLAST)

  const n = debrisCount(base.radius)
  for (let i = 0; i < n; i++) {
    spawnRockDebrisPod(
      world,
      base.pos,
      _still,
      base.shape,
      MONOLITH.ROCK_DEBRIS_RADIUS * (0.7 + world.rng() * 0.6),
      MONOLITH.ROCK_DEBRIS_MASS,
      MONOLITH.ROCK_DEBRIS_SPEED,
    )
  }
}

/** Урон корпусу базы. Прочность кончилась — взрыв и осколки. */
export function damageWarBase(world: World, base: WarBaseEntity, amount: number): void {
  if (!base.alive) return
  base.hull -= amount
  if (base.hull <= 0) destroyWarBase(world, base)
}

/**
 * Отстрел ДЕТАЛИ. Прочность кончилась — деталь гибнет отдельной вспышкой в своей точке,
 * корпус базы цел. Взрыв масштаба детали (не базы), без осколков-руды — это не снос базы.
 */
export function damageWarBaseFixture(world: World, base: WarBaseEntity, fix: WarBaseFixture, amount: number): void {
  if (!fix.alive) return
  fix.hull -= amount
  if (fix.hull > 0) return
  fix.alive = false
  warBaseFixtureWorldPos(base, fix, world.time, _fixWorld)
  spawnExplosion(world, _fixWorld, _still, fix.size * 1.2)
}
