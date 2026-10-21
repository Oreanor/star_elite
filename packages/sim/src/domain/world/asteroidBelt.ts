import { Quaternion, Vector3 } from 'three'
import { BELT } from '../../config/belt'
import { ASTEROID } from '../../config/world'
import { retain } from '../../core/list'
import type { AsteroidEntity, World } from './entities'
import type { SystemDef } from './system'

interface StoredRock {
  body: AsteroidEntity
  /** Вне окна тел pos хранится в абсолютных координатах. */
  parkedAt: number | null
}

/**
 * Зарезервированный id нав-цели «весь пояс». Отрицательный, чтобы не столкнуться
 * с `world.ids` (они положительные). Карта и локатор пишут в `navTargetId` его же.
 */
export const BELT_NAV_ID = -2

/**
 * ДАЛЬНЯЯ ДУГА — точки, не тела. Телами (`world.asteroids`) пояс живёт лишь в окне мешей
 * (`BELT.ENTITY_RANGE`): там камни сталкиваются, добываются, берутся в цель. Дальше на небе
 * только черта из точек — раньше и она была тысячами полноценных тел, которые каждый такт
 * интегрировала физика, вёл след позы и перебирал рендер (6690 тел ради 600 ближних).
 *
 * Точка — ИСТИННЫЕ координаты на миг пересборки и дрейф: рендер сдвигает её по времени и
 * вычитает текущее плавающее начало сам. Без физики и без следов.
 */
export interface BeltDots {
  /** Истинные координаты (local + originOffset) на момент `time`, по три на точку. */
  pos: Float64Array
  /** Дрейф, м/с, по три на точку. */
  drift: Float32Array
  count: number
  /** `world.time` пересборки. */
  time: number
}

export interface AsteroidBelt {
  seed: number
  center: Vector3
  radius: number
  diameter: number
  count: number
  nextUpdate: number
  /** Камни, хоть раз ставшие телом: добытые не воскресают, сдвинутые летят своим путём. */
  rocks: Map<number, StoredRock>
  dots: BeltDots
}

export function createAsteroidBelt(def: SystemDef): AsteroidBelt | undefined {
  if (!def.orbitalBelt) return undefined
  return {
    seed: def.seed, center: new Vector3(...def.star.pos), radius: def.orbitalBelt.radius,
    diameter: BELT.TUBE_DIAMETER, count: BELT.LOCAL_COUNT, nextUpdate: -1,
    rocks: new Map(),
    dots: {
      pos: new Float64Array(BELT.MAX_DOTS * 3),
      drift: new Float32Array(BELT.MAX_DOTS * 3),
      count: 0,
      time: 0,
    },
  }
}

const _center = new Vector3()
const _pos = new Vector3()
const _vel = new Vector3()
const _axis = new Vector3()
const TAU = Math.PI * 2
/** Адрес камня — число: сектор·SLOT_KEY + слот. Строка на каждый слот дуги была мусором. */
const SLOT_KEY = 65_536

/**
 * Поток сектора — mulberry32 без замыкания: тот же ряд, что `makeRng` с тем же зерном, значит
 * и раскладка пояса прежняя. Замыкание на сектор (их двадцать тысяч на пересборку) — мусор.
 */
let _rs = 0
function seedSector(belt: AsteroidBelt, sector: number): void {
  _rs = (belt.seed ^ Math.imul(sector + 1, 0x45d9f3b)) >>> 0
}
function rnd(): number {
  _rs = (_rs + 0x6d2b79f5) >>> 0
  let t = Math.imul(_rs ^ (_rs >>> 15), 1 | _rs)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/**
 * Кувырок по оси, рад/с. Ноль по оси выпадает часто, и камень тогда не кувыркается.
 * Знак и доля — из одного броска.
 */
function tumble(u: number): number {
  return (u < 0.5 ? -1 : 1) * (0.45 + Math.abs(u - 0.5) * 2 * 0.55) * BELT.SPIN_MAX
}

/** Итог `sectorKeep` — модульный, без объекта на вызов. */
const _keep = { n: 0, nKeep: 0, span: 1 }

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
): void {
  seedSector(belt, sector)
  const n = Math.floor(perSector) + (rnd() < perSector % 1 ? 1 : 0)
  _keep.n = n
  const theta = (sector + 0.5) / sectors * TAU + phase
  _pos.set(Math.cos(theta) * belt.radius, 0, Math.sin(theta) * belt.radius).add(_center)
  const dist = _pos.distanceTo(player)
  const full = dist <= BELT.LOCAL_RANGE + sectorLength
  const fall = Math.max(0, dist - BELT.LOCAL_RANGE)
  const width = 2 ** (-fall / BELT.THIN_STEP)
  const count = 2 ** (-fall / BELT.COUNT_STEP)
  if (full) {
    _keep.nKeep = n
    _keep.span = 1
    return
  }
  const want = n * count
  const span = Math.max(BELT.STREAM_CORE, width)
  // Пол по углу. Ближе экспонента и так гуще — её не поднимаем, только не даём упасть ниже угла.
  const farMean = sectorLength / Math.max(dist * BELT.FAR_ANGULAR, 1)
  if (want >= farMean) {
    if (want >= 1) {
      _keep.nKeep = Math.round(want)
      _keep.span = span
      return
    }
    const stride = Math.max(1, Math.round(1 / want))
    const slot = Math.floor(rnd() * stride)
    _keep.nKeep = sector % stride === slot ? 1 : 0
    _keep.span = BELT.STREAM_CORE
    return
  }
  const mean = Math.min(n, farMean)
  const whole = Math.floor(mean)
  _keep.nKeep = Math.min(n, whole + (rnd() < mean - whole ? 1 : 0))
  _keep.span = BELT.STREAM_CORE
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

/** Числовой адрес из ярлыка тела `сектор:слот` (ярлык — для потребителей, флаг «камень пояса»). */
function keyOf(beltKey: string): number {
  const colon = beltKey.indexOf(':')
  return Number(beltKey.slice(0, colon)) * SLOT_KEY + Number(beltKey.slice(colon + 1))
}

export function stepAsteroidBelt(world: World): void {
  const belt = world.asteroidBelt
  if (!belt || world.time < belt.nextUpdate) return
  belt.nextUpdate = world.time + BELT.STREAM_INTERVAL
  const player = world.player.state.pos
  const off = world.originOffset
  _center.copy(belt.center).sub(off)
  const circumference = TAU * belt.radius
  const sectors = Math.max(1, Math.ceil(circumference / BELT.SECTOR_LENGTH))
  const sectorLength = circumference / sectors
  const phase = world.time * BELT.DRIFT_SPEED / belt.radius
  const tubeR = belt.diameter / 2
  const r = BELT.LOCAL_RANGE
  // Средняя хорда трубы внутри локатора короче диаметра локатора.
  const chord = 4 * (r ** 3 - (r * r - tubeR * tubeR) ** 1.5) / (3 * tubeR * tubeR)
  const perSector = belt.count * sectorLength / chord
  const entityR2 = BELT.ENTITY_RANGE * BELT.ENTITY_RANGE
  const park = (a: AsteroidEntity) => {
    const stored = belt.rocks.get(keyOf(a.beltKey!))
    if (stored) {
      a.pos.add(off)
      stored.parkedAt = world.time
    }
    return false
  }
  // Тела, ушедшие из окна тел, и лишние на краю (слот выше потолка сектора) паркуются со
  // скоростью, повреждениями и размером. Погибшие — свой адрес, чтобы не воскреснуть.
  retain(world.asteroids, a => {
    if (!a.beltKey) return true
    if (!a.alive) return false
    if (world.player.landedOn?.bodyId === a.id || world.navTargetId === a.id || world.contactLock?.id === a.id) return true
    if (a.pos.distanceToSquared(player) > entityR2) return park(a)
    const key = keyOf(a.beltKey)
    const sector = Math.floor(key / SLOT_KEY)
    sectorKeep(belt, sector, sectors, sectorLength, perSector, phase, player)
    if (key - sector * SLOT_KEY >= _keep.nKeep) return park(a)
    return true
  })

  const dots = belt.dots
  dots.count = 0
  dots.time = world.time
  nearestBeltPoint(world, _pos)
  if (_pos.distanceTo(player) > BELT.VISIBLE_RANGE + belt.diameter / 2) return
  const visibleR2 = BELT.VISIBLE_RANGE * BELT.VISIBLE_RANGE
  const angle = ((Math.atan2(player.z - _center.z, player.x - _center.x) - phase) % TAU + TAU) % TAU
  const middle = Math.floor(angle / TAU * sectors)
  const reach = Math.ceil((BELT.VISIBLE_RANGE + belt.diameter) / sectorLength)
  for (let offset = -reach; offset <= reach; offset++) {
    const sector = (middle + offset + sectors) % sectors
    sectorKeep(belt, sector, sectors, sectorLength, perSector, phase, player)
    const nKeep = Math.min(_keep.nKeep, _keep.n)
    if (nKeep <= 0) continue
    const span = _keep.span
    // Свой поток слотов — с начала: первый бросок сектора ушёл на число слотов.
    seedSector(belt, sector)
    rnd()
    for (let slot = 0; slot < nKeep; slot++) {
      const theta = (sector + rnd()) / sectors * TAU + phase
      const crossAngle = rnd() * TAU
      const crossR = Math.sqrt(rnd()) * tubeR * span
      const radial = belt.radius + Math.cos(crossAngle) * crossR
      _pos.set(Math.cos(theta) * radial, Math.sin(crossAngle) * crossR, Math.sin(theta) * radial).add(_center)
      const radius = BELT.RADIUS_MIN + (BELT.RADIUS_MAX - BELT.RADIUS_MIN) * rnd() ** 3
      const spinX = tumble(rnd())
      const spinY = tumble(rnd())
      const spinZ = tumble(rnd())
      const shape = Math.floor(rnd() * ASTEROID.SHAPES)
      _axis.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5)
      if (_axis.lengthSq() < 1e-8) _axis.set(0, 1, 0)
      const tilt = rnd() * TAU

      const key = sector * SLOT_KEY + slot
      const stored = belt.rocks.get(key)
      // Добыт — адрес пуст навсегда; уже тело — оно в мире и без нас.
      if (stored && (!stored.body.alive || stored.parkedAt === null)) continue
      if (stored) _pos.copy(stored.body.pos).addScaledVector(stored.body.vel, world.time - stored.parkedAt!).sub(off)
      const d2 = _pos.distanceToSquared(player)
      if (d2 > visibleR2) continue

      if (d2 <= entityR2) {
        if (stored) {
          stored.body.pos.copy(_pos)
          stored.parkedAt = null
          world.asteroids.push(stored.body)
        } else {
          _vel.set(-Math.sin(theta) * BELT.DRIFT_SPEED, 0, Math.cos(theta) * BELT.DRIFT_SPEED)
          const body: AsteroidEntity = {
            id: world.ids.next(), kind: 'asteroid', beltKey: `${sector}:${slot}`,
            pos: _pos.clone(), vel: _vel.clone(), radius, shape, hull: ASTEROID.HULL, alive: true,
            spin: new Vector3(spinX, spinY, spinZ),
            quat: new Quaternion().setFromAxisAngle(_axis.normalize(), tilt),
          }
          belt.rocks.set(key, { body, parkedAt: null })
          world.asteroids.push(body)
        }
        continue
      }

      // Дальше окна тел — точка дуги. Сдвинутый камень — своим путём, прочие — дрейфом пояса.
      if (dots.count >= BELT.MAX_DOTS) continue
      const o = dots.count * 3
      dots.pos[o] = _pos.x + off.x
      dots.pos[o + 1] = _pos.y + off.y
      dots.pos[o + 2] = _pos.z + off.z
      if (stored) {
        dots.drift[o] = stored.body.vel.x
        dots.drift[o + 1] = stored.body.vel.y
        dots.drift[o + 2] = stored.body.vel.z
      } else {
        dots.drift[o] = -Math.sin(theta) * BELT.DRIFT_SPEED
        dots.drift[o + 1] = 0
        dots.drift[o + 2] = Math.cos(theta) * BELT.DRIFT_SPEED
      }
      dots.count++
    }
  }
}
