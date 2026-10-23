import { Quaternion, Vector3 } from 'three'
import { BELT } from '../../config/belt'
import { ASTEROID } from '../../config/world'
import { retain } from '../../core/list'
import type { IdSource } from './ids'
import type { AsteroidEntity, World } from './entities'
import type { SystemDef } from './system'

interface StoredRock {
  body: AsteroidEntity
  /** Вне окна тел pos хранится ОТ ЦЕНТРА пояса в истинных осях: центр может ехать с телом. */
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
  /** Свой id: камень помнит пояс (`AsteroidEntity.beltId`), поясов в системе несколько. */
  id: number
  seed: number
  /** Центр кольца в ИСТИННЫХ координатах (local + originOffset). */
  center: Vector3
  /** Ход центра, м/с: у пояса вокруг планеты центр едет с ней, точки дуги — тоже. */
  centerVel: Vector3
  /**
   * Тело, вокруг которого кольцо (id): центр каждый такт берётся с него. `null` — центр
   * неподвижен (барицентр/светило в начале системы). Тело погибло — центр замирает.
   */
  parentId: number | null
  /** Наклон плоскости кольца, рад — той же конвенции, что `OrbitDef.tilt` (`orbitPoint`). */
  tilt: number
  /**
   * Дуга вместо кольца: середина и полураствор, рад, в ВРАЩАЮЩЕМСЯ с дрейфом угле сектора.
   * `null` — кольцо целиком. Дуга — обломки луны: им не успеть растечься по всей орбите.
   */
  arc: { mid: number; half: number } | null
  radius: number
  diameter: number
  count: number
  nextUpdate: number
  /** Камни, хоть раз ставшие телом: добытые не воскресают, сдвинутые летят своим путём. */
  rocks: Map<number, StoredRock>
  dots: BeltDots
}

export interface BeltSpec {
  seed: number
  /** Истинные координаты центра. */
  center: Vector3
  parentId: number | null
  radius: number
  tilt: number
  arc: { mid: number; half: number } | null
  diameter: number
  count: number
}

export function makeAsteroidBelt(ids: IdSource, spec: BeltSpec): AsteroidBelt {
  return {
    id: ids.next(),
    seed: spec.seed, center: spec.center.clone(), centerVel: new Vector3(), parentId: spec.parentId,
    tilt: spec.tilt, arc: spec.arc, radius: spec.radius,
    diameter: spec.diameter, count: spec.count, nextUpdate: -1,
    rocks: new Map(),
    dots: {
      pos: new Float64Array(BELT.MAX_DOTS * 3),
      drift: new Float32Array(BELT.MAX_DOTS * 3),
      count: 0,
      time: 0,
    },
  }
}

/** Постоянный пояс системы (между внутренними планетами) — список из одного или пустой. */
export function createAsteroidBelts(ids: IdSource, def: SystemDef): AsteroidBelt[] {
  if (!def.orbitalBelt) return []
  return [makeAsteroidBelt(ids, {
    seed: def.seed, center: new Vector3(...def.star.pos), parentId: null, radius: def.orbitalBelt.radius,
    tilt: 0, arc: null, diameter: BELT.TUBE_DIAMETER, count: BELT.LOCAL_COUNT,
  })]
}

const _center = new Vector3()
const _pos = new Vector3()
const _vel = new Vector3()
const _axis = new Vector3()
const TAU = Math.PI * 2
/** Адрес камня — число: сектор·SLOT_KEY + слот. Строка на каждый слот дуги была мусором. */
const SLOT_KEY = 65_536
const _rel = new Vector3()

/** Из плоскости кольца в истинные оси (поворот вокруг X на наклон, как в `orbitPoint`). */
function toWorld(belt: AsteroidBelt, v: Vector3): Vector3 {
  if (belt.tilt === 0) return v
  const c = Math.cos(belt.tilt)
  const sn = Math.sin(belt.tilt)
  const y = v.y
  return v.set(v.x, y * c + v.z * sn, -y * sn + v.z * c)
}

/** Обратно: из истинных осей в плоскость кольца. */
function toRing(belt: AsteroidBelt, v: Vector3): Vector3 {
  if (belt.tilt === 0) return v
  const c = Math.cos(belt.tilt)
  const sn = Math.sin(belt.tilt)
  const y = v.y
  return v.set(v.x, y * c - v.z * sn, y * sn + v.z * c)
}

/** Угол к (−π, π]. */
function wrapPi(a: number): number {
  return a - TAU * Math.floor((a + Math.PI) / TAU)
}

/**
 * Доля слотов сектора у дуги: 1 в середине, к концам спадает косинусом — обломки луны
 * редеют к краям, а не обрываются ножом. Вне дуги — ноль. У кольца — всегда 1.
 */
function arcWeight(belt: AsteroidBelt, sector: number, sectors: number): number {
  const arc = belt.arc
  if (!arc) return 1
  const d = Math.abs(wrapPi((sector + 0.5) / sectors * TAU - arc.mid))
  if (d >= arc.half) return 0
  return 0.5 + 0.5 * Math.cos(Math.PI * d / arc.half)
}

/** Фаза дрейфа кольца, рад: на столько сектора уехали к моменту `time`. */
function beltPhase(belt: AsteroidBelt, time: number): number {
  return time * BELT.DRIFT_SPEED / belt.radius
}

/** Центр кольца в ЛОКАЛЬНЫХ координатах мира. */
function localCenter(world: World, belt: AsteroidBelt, out: Vector3): Vector3 {
  return out.copy(belt.center).sub(world.originOffset)
}

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
  const weight = arcWeight(belt, sector, sectors)
  if (weight <= 0) {
    _keep.nKeep = 0
    _keep.span = 1
    return
  }
  sectorKeepRaw(belt, n, sector, sectors, sectorLength, phase, player)
  // Дуга: слоты сектора редеют к её концам (тот же префикс слотов — камни не перескакивают).
  if (weight < 1) _keep.nKeep = Math.floor(_keep.nKeep * weight + 0.5)
}

function sectorKeepRaw(
  belt: AsteroidBelt,
  n: number,
  sector: number,
  sectors: number,
  sectorLength: number,
  phase: number,
  player: Vector3,
): void {
  const theta = (sector + 0.5) / sectors * TAU + phase
  toWorld(belt, _pos.set(Math.cos(theta) * belt.radius, 0, Math.sin(theta) * belt.radius)).add(_center)
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

/** Ближайшая к игроку точка оси ЭТОГО пояса (у дуги — зажатая в её концы), локальные координаты. */
export function beltPoint(world: World, belt: AsteroidBelt, out: Vector3): Vector3 {
  localCenter(world, belt, _center)
  toRing(belt, _rel.copy(world.player.state.pos).sub(_center))
  let angle = Math.atan2(_rel.z, _rel.x)
  if (belt.arc) {
    const phase = beltPhase(belt, world.time)
    const d = wrapPi(angle - phase - belt.arc.mid)
    angle = phase + belt.arc.mid + Math.max(-belt.arc.half, Math.min(belt.arc.half, d))
  }
  return toWorld(belt, out.set(Math.cos(angle) * belt.radius, 0, Math.sin(angle) * belt.radius)).add(_center)
}

const _near = new Vector3()

/** Ближайший к игроку пояс (по точке оси) или null — поясов нет. */
export function nearestBelt(world: World): AsteroidBelt | null {
  let best: AsteroidBelt | null = null
  let bestSq = Infinity
  for (const belt of world.asteroidBelts) {
    const d = beltPoint(world, belt, _near).distanceToSquared(world.player.state.pos)
    if (d < bestSq) {
      bestSq = d
      best = belt
    }
  }
  return best
}

/**
 * Ближайшая точка оси трубы ближайшего пояса. Общая геометрия для карты, локатора и настройки.
 * Нав-цель «пояс» (`BELT_NAV_ID`) — всегда ближайший: идёшь к тому, что под боком.
 */
export function nearestBeltPoint(world: World, out: Vector3): Vector3 {
  const belt = nearestBelt(world)
  if (!belt) return out.copy(world.player.state.pos)
  return beltPoint(world, belt, out)
}

/** Настройка плотности пересоздаёт только постоянный пояс; прочие встречи и обломки остаются. */
export function configureAsteroidBelt(world: World, diameter: number, count: number): void {
  const belt = world.asteroidBelts[0]
  if (!belt) return
  belt.diameter = Math.max(BELT.DIAMETER_MIN, Math.min(BELT.DIAMETER_MAX, diameter))
  belt.count = Math.round(Math.max(BELT.COUNT_MIN, Math.min(BELT.COUNT_MAX, count)))
  retain(world.asteroids, a => !a.beltKey || a.beltId !== belt.id)
  // Мёртвые адреса сохраняем даже при настройке, чтобы добытые камни не воскресали.
  for (const [key, stored] of belt.rocks) if (stored.body.alive) belt.rocks.delete(key)
  belt.nextUpdate = -1
  stepBelt(world, belt)
}

/** Числовой адрес из ярлыка тела `сектор:слот` (ярлык — для потребителей, флаг «камень пояса»). */
function keyOf(beltKey: string): number {
  const colon = beltKey.indexOf(':')
  return Number(beltKey.slice(0, colon)) * SLOT_KEY + Number(beltKey.slice(colon + 1))
}

const _prevCenter = new Vector3()

/**
 * Центр пояса с телом-хозяином — с тела, КАЖДЫЙ такт (и ход центра — для дрейфа точек между
 * пересборками). Хозяин погиб — центр замирает там, где был.
 */
function followParent(world: World, belt: AsteroidBelt, dt: number): void {
  if (belt.parentId === null) return
  const parent = world.bodies.find(b => b.id === belt.parentId)
  if (!parent) {
    belt.centerVel.set(0, 0, 0)
    return
  }
  _prevCenter.copy(belt.center)
  belt.center.copy(parent.pos).add(world.originOffset)
  if (dt > 0) belt.centerVel.copy(belt.center).sub(_prevCenter).divideScalar(dt)
}

/** Все пояса системы: центры с хозяевами и пересборка окна тел/точек по сроку. */
export function stepAsteroidBelt(world: World, dt = 0): void {
  for (const belt of world.asteroidBelts) {
    followParent(world, belt, dt)
    stepBelt(world, belt)
  }
}

function stepBelt(world: World, belt: AsteroidBelt): void {
  if (world.time < belt.nextUpdate) return
  belt.nextUpdate = world.time + BELT.STREAM_INTERVAL
  const player = world.player.state.pos
  const off = world.originOffset
  localCenter(world, belt, _center)
  const circumference = TAU * belt.radius
  const sectors = Math.max(1, Math.ceil(circumference / BELT.SECTOR_LENGTH))
  const sectorLength = circumference / sectors
  const phase = beltPhase(belt, world.time)
  const tubeR = belt.diameter / 2
  const r = BELT.LOCAL_RANGE
  // Средняя хорда трубы внутри локатора короче диаметра локатора.
  const chord = 4 * (r ** 3 - (r * r - tubeR * tubeR) ** 1.5) / (3 * tubeR * tubeR)
  const perSector = belt.count * sectorLength / chord
  const entityR2 = BELT.ENTITY_RANGE * BELT.ENTITY_RANGE
  const park = (a: AsteroidEntity) => {
    const stored = belt.rocks.get(keyOf(a.beltKey!))
    if (stored) {
      a.pos.add(off).sub(belt.center)
      stored.parkedAt = world.time
    }
    return false
  }
  // Тела, ушедшие из окна тел, и лишние на краю (слот выше потолка сектора) паркуются со
  // скоростью, повреждениями и размером. Погибшие — свой адрес, чтобы не воскреснуть.
  retain(world.asteroids, a => {
    if (!a.beltKey || a.beltId !== belt.id) return true
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
  beltPoint(world, belt, _pos)
  if (_pos.distanceTo(player) > BELT.VISIBLE_RANGE + belt.diameter / 2) return
  const visibleR2 = BELT.VISIBLE_RANGE * BELT.VISIBLE_RANGE
  toRing(belt, _rel.copy(player).sub(_center))
  const angle = ((Math.atan2(_rel.z, _rel.x) - phase) % TAU + TAU) % TAU
  const middle = Math.floor(angle / TAU * sectors)
  // Кольцо короче окна (дуга вокруг луны) — не обходить один сектор дважды с двух сторон.
  const reach = Math.min(Math.ceil((BELT.VISIBLE_RANGE + belt.diameter) / sectorLength), Math.floor((sectors - 1) / 2))
  for (let offset = -reach; offset <= reach; offset++) {
    const sector = ((middle + offset) % sectors + sectors) % sectors
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
      toWorld(belt, _pos.set(Math.cos(theta) * radial, Math.sin(crossAngle) * crossR, Math.sin(theta) * radial)).add(_center)
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
      // Припаркованный хранится от центра пояса: центр мог уехать с хозяином.
      if (stored) _pos.copy(stored.body.pos).addScaledVector(stored.body.vel, world.time - stored.parkedAt!).add(_center)
      const d2 = _pos.distanceToSquared(player)
      if (d2 > visibleR2) continue

      if (d2 <= entityR2) {
        if (stored) {
          stored.body.pos.copy(_pos)
          stored.parkedAt = null
          world.asteroids.push(stored.body)
        } else {
          toWorld(belt, _vel.set(-Math.sin(theta) * BELT.DRIFT_SPEED, 0, Math.cos(theta) * BELT.DRIFT_SPEED))
          const body: AsteroidEntity = {
            id: world.ids.next(), kind: 'asteroid', beltKey: `${sector}:${slot}`, beltId: belt.id,
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
      if (stored) _vel.copy(stored.body.vel)
      else toWorld(belt, _vel.set(-Math.sin(theta) * BELT.DRIFT_SPEED, 0, Math.cos(theta) * BELT.DRIFT_SPEED))
      // Пояс вокруг планеты едет с ней: точки дуги — тоже, иначе между пересборками отстают.
      _vel.add(belt.centerVel)
      dots.drift[o] = _vel.x
      dots.drift[o + 1] = _vel.y
      dots.drift[o + 2] = _vel.z
      dots.count++
    }
  }
}
