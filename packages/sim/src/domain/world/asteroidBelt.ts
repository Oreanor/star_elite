import { Quaternion, Vector3 } from 'three'
import { BELT } from '../../config/belt'
import { ASTEROID } from '../../config/world'
import { makeRng } from '../../core/math'
import { retain } from '../../core/list'
import type { AsteroidEntity, World } from './entities'
import type { SystemDef } from './system'

interface StoredRock {
  body: AsteroidEntity
  /** Вне активного окна pos хранится в абсолютных координатах. */
  parkedAt: number | null
}

/**
 * Зарезервированный id нав-цели «весь пояс». Отрицательный, чтобы не столкнуться
 * с `world.ids` (они положительные). Карта и локатор пишут в `navTargetId` его же.
 */
export const BELT_NAV_ID = -2

export interface AsteroidBelt {
  seed: number
  center: Vector3
  radius: number
  diameter: number
  count: number
  nextUpdate: number
  rocks: Map<string, StoredRock>
}

export function createAsteroidBelt(def: SystemDef): AsteroidBelt | undefined {
  if (!def.orbitalBelt) return undefined
  return {
    seed: def.seed, center: new Vector3(...def.star.pos), radius: def.orbitalBelt.radius,
    diameter: BELT.TUBE_DIAMETER, count: BELT.LOCAL_COUNT, nextUpdate: -1,
    rocks: new Map(),
  }
}

const _center = new Vector3()
const _pos = new Vector3()
const _vel = new Vector3()
const _axis = new Vector3()
const TAU = Math.PI * 2

/**
 * Сколько слотов сектора живы на этой дистанции и в какой доле радиуса трубы они лежат.
 * Ближе локатора — полная труба. Сечение делится надвое каждые `THIN_STEP`:
 * силуэт с пары сотен километров иначе остаётся пальцем, даже если точек меньше.
 * Число падает медленнее, на `COUNT_STEP`: иначе дуга пустеет за пару сотен километров.
 * Ниже экспоненты пол — угол `FAR_ANGULAR`, не фиксированные километры: иначе на 800 км
 * дыра в несколько градусов, а на пяти тысячах тот же шаг слипается в пунктир.
 * Дробная часть шага — бросок зерна, не решётка `sector % stride`: на небе это линейка.
 * `STREAM_CORE` не даёт нити схлопнуться в ноль.
 */
function sectorKeep(
  belt: AsteroidBelt,
  sector: number,
  sectors: number,
  sectorLength: number,
  perSector: number,
  phase: number,
  player: Vector3,
): { nKeep: number; span: number } {
  const rng = makeRng(belt.seed ^ Math.imul(sector + 1, 0x45d9f3b))
  const n = Math.floor(perSector) + (rng() < perSector % 1 ? 1 : 0)
  const theta = (sector + 0.5) / sectors * TAU + phase
  _pos.set(Math.cos(theta) * belt.radius, 0, Math.sin(theta) * belt.radius).add(_center)
  const dist = _pos.distanceTo(player)
  const full = dist <= BELT.LOCAL_RANGE + sectorLength
  const fall = Math.max(0, dist - BELT.LOCAL_RANGE)
  const width = 2 ** (-fall / BELT.THIN_STEP)
  const count = 2 ** (-fall / BELT.COUNT_STEP)
  if (full) return { nKeep: n, span: 1 }
  const want = n * count
  const span = Math.max(BELT.STREAM_CORE, width)
  // Пол по углу. Ближе экспонента и так гуще — её не поднимаем, только не даём упасть ниже угла.
  const farMean = sectorLength / Math.max(dist * BELT.FAR_ANGULAR, 1)
  if (want >= farMean) {
    if (want >= 1) return { nKeep: Math.round(want), span }
    const stride = Math.max(1, Math.round(1 / want))
    const slot = Math.floor(rng() * stride)
    return { nKeep: sector % stride === slot ? 1 : 0, span: BELT.STREAM_CORE }
  }
  const mean = Math.min(n, farMean)
  const whole = Math.floor(mean)
  return { nKeep: Math.min(n, whole + (rng() < mean - whole ? 1 : 0)), span: BELT.STREAM_CORE }
}

/** Ближайшая точка оси трубы. Общая геометрия для карты, локатора и настройки. */
export function nearestBeltPoint(world: World, out: Vector3): Vector3 {
  const belt = world.asteroidBelt
  if (!belt) return out.copy(world.player.state.pos)
  _center.copy(belt.center).sub(world.originOffset)
  const p = world.player.state.pos
  const angle = Math.atan2(p.z - _center.z, p.x - _center.x)
  return out.set(Math.cos(angle) * belt.radius, 0, Math.sin(angle) * belt.radius).add(_center)
}

/** Настройка плотности пересоздаёт только пояс; прочие встречи и обломки остаются. */
export function configureAsteroidBelt(world: World, diameter: number, count: number): void {
  const belt = world.asteroidBelt
  if (!belt) return
  belt.diameter = Math.max(BELT.DIAMETER_MIN, Math.min(BELT.DIAMETER_MAX, diameter))
  belt.count = Math.round(Math.max(BELT.COUNT_MIN, Math.min(BELT.COUNT_MAX, count)))
  retain(world.asteroids, a => a.beltKey === undefined)
  // Мёртвые адреса сохраняем даже при настройке, чтобы добытые камни не воскресали.
  for (const [key, stored] of belt.rocks) if (stored.body.alive) belt.rocks.delete(key)
  belt.nextUpdate = -1
  stepAsteroidBelt(world)
}

export function stepAsteroidBelt(world: World): void {
  const belt = world.asteroidBelt
  if (!belt || world.time < belt.nextUpdate) return
  belt.nextUpdate = world.time + BELT.STREAM_INTERVAL
  const player = world.player.state.pos
  const exitRange = BELT.VISIBLE_RANGE + BELT.SECTOR_LENGTH
  _center.copy(belt.center).sub(world.originOffset)
  const circumference = TAU * belt.radius
  const sectors = Math.max(1, Math.ceil(circumference / BELT.SECTOR_LENGTH))
  const sectorLength = circumference / sectors
  const phase = world.time * BELT.DRIFT_SPEED / belt.radius
  const tubeR = belt.diameter / 2
  const r = BELT.LOCAL_RANGE
  // Средняя хорда трубы внутри локатора короче диаметра локатора.
  const chord = 4 * (r ** 3 - (r * r - tubeR * tubeR) ** 1.5) / (3 * tubeR * tubeR)
  const perSector = belt.count * sectorLength / chord
  const park = (a: AsteroidEntity) => {
    const stored = belt.rocks.get(a.beltKey!)
    if (stored) {
      a.pos.add(world.originOffset)
      stored.parkedAt = world.time
    }
    return false
  }
  // Ушедшие из окна и лишние на дальней дуге сохраняют скорость, повреждения и размер.
  // Погибшие — свой адрес. Слот выше текущего потолка паркуется, иначе пролёт вдоль пояса
  // оставил бы полную плотность на всё окно.
  retain(world.asteroids, a => {
    if (!a.beltKey) return true
    if (!a.alive) return false
    if (world.player.landedOn?.bodyId === a.id || world.navTargetId === a.id || world.contactLock?.id === a.id) return true
    if (a.pos.distanceToSquared(player) > exitRange * exitRange) return park(a)
    const colon = a.beltKey.indexOf(':')
    const sector = Number(a.beltKey.slice(0, colon))
    const slot = Number(a.beltKey.slice(colon + 1))
    if (slot >= sectorKeep(belt, sector, sectors, sectorLength, perSector, phase, player).nKeep) return park(a)
    return true
  })
  nearestBeltPoint(world, _pos)
  if (_pos.distanceTo(player) > BELT.VISIBLE_RANGE + belt.diameter / 2) return
  const angle = ((Math.atan2(player.z - _center.z, player.x - _center.x) - phase) % TAU + TAU) % TAU
  const middle = Math.floor(angle / TAU * sectors)
  const reach = Math.ceil((BELT.VISIBLE_RANGE + belt.diameter) / sectorLength)
  for (let offset = -reach; offset <= reach; offset++) {
    const sector = (middle + offset + sectors) % sectors
    const rng = makeRng(belt.seed ^ Math.imul(sector + 1, 0x45d9f3b))
    const n = Math.floor(perSector) + (rng() < perSector % 1 ? 1 : 0)
    const { nKeep, span } = sectorKeep(belt, sector, sectors, sectorLength, perSector, phase, player)
    for (let slot = 0; slot < nKeep && slot < n; slot++) {
      const key = `${sector}:${slot}`
      const theta = (sector + rng()) / sectors * TAU + phase
      const crossAngle = rng() * TAU
      const crossR = Math.sqrt(rng()) * tubeR * span
      const radial = belt.radius + Math.cos(crossAngle) * crossR
      _pos.set(Math.cos(theta) * radial, Math.sin(crossAngle) * crossR, Math.sin(theta) * radial).add(_center)
      const radius = BELT.RADIUS_MIN + (BELT.RADIUS_MAX - BELT.RADIUS_MIN) * rng() ** 3
      // Ноль по оси выпадает часто, и камень тогда не кувыркается. Знак и доля — из одного броска.
      const tumble = (u: number) => (u < 0.5 ? -1 : 1) * (0.45 + Math.abs(u - 0.5) * 2 * 0.55) * BELT.SPIN_MAX
      const spinX = tumble(rng())
      const spinY = tumble(rng())
      const spinZ = tumble(rng())
      const shape = Math.floor(rng() * ASTEROID.SHAPES)
      _axis.set(rng() - 0.5, rng() - 0.5, rng() - 0.5)
      if (_axis.lengthSq() < 1e-8) _axis.set(0, 1, 0)
      const tilt = rng() * TAU
      const stored = belt.rocks.get(key)
      if (stored && (!stored.body.alive || stored.parkedAt === null)) continue
      if (stored) _pos.copy(stored.body.pos).addScaledVector(stored.body.vel, world.time - stored.parkedAt!).sub(world.originOffset)
      if (_pos.distanceToSquared(player) > BELT.VISIBLE_RANGE ** 2) continue
      if (stored) {
        stored.body.pos.copy(_pos)
        stored.parkedAt = null
        world.asteroids.push(stored.body)
      } else {
        _vel.set(-Math.sin(theta) * BELT.DRIFT_SPEED, 0, Math.cos(theta) * BELT.DRIFT_SPEED)
        const body: AsteroidEntity = {
          id: world.ids.next(), kind: 'asteroid', beltKey: key,
          pos: _pos.clone(), vel: _vel.clone(), radius, shape, hull: ASTEROID.HULL, alive: true,
          spin: new Vector3(spinX, spinY, spinZ),
          quat: new Quaternion().setFromAxisAngle(_axis.normalize(), tilt),
        }
        belt.rocks.set(key, { body, parkedAt: null })
        world.asteroids.push(body)
      }
    }
  }
}
