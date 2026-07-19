import { Vector3 } from 'three'
import { GRAVITY } from '../../config/bodies'
import { SCALE } from '../../config/galaxy'
import { orbitSec } from '../../config/time'
import type { BodyEntity, OrbitDef, World } from './entities'

/**
 * Орбиты тел: угол = phase + rate·t, позиция считается заново каждый шаг.
 *
 * Часы — общие физические секунды: `orbitSec(world.calendarTime)`.
 * Дата HUD ускорена отдельно; кеплеровское движение не умножается на `TIME.SCALE`.
 * Не `world.time`: тот замирает в доке и локален физике. Два клиента и вход в
 * систему через год игры обязаны увидеть одну и ту же расстановку.
 *
 * Планеты, луны, станции и звёзды двойной — ω = √(GM/r³), периоды не назначаются.
 */

const _radial = /* @__PURE__ */ new Vector3()
const _out = /* @__PURE__ */ new Vector3()
const _bary = /* @__PURE__ */ new Vector3()
const _offset = /* @__PURE__ */ new Vector3()
const _stationBefore = /* @__PURE__ */ new Vector3()
const _stationShift = /* @__PURE__ */ new Vector3()
const _playerReferenceBefore = /* @__PURE__ */ new Vector3()
const _playerReferenceShift = /* @__PURE__ */ new Vector3()

/** Момент для орбит: общие физические секунды с серверного якоря. */
export function orbitTime(world: World): number {
  return orbitSec(world.calendarTime)
}

/** ω вокруг точки массы M на радиусе r, рад/с. */
export function keplerRate(centralMass: number, orbitRadius: number): number {
  return Math.sqrt((GRAVITY.G * centralMass) / orbitRadius ** 3)
}

/** Масса звезды из радиуса (старый путь: ∝ R³). Для дыр и тестов без massSolar. */
export function starMass(radius: number): number {
  return GRAVITY.STAR_DENSITY * (4 / 3) * Math.PI * radius ** 3
}

/** Масса звезды из каталожной massSolar — честная, не раздутая гигантом. */
export function starMassSolar(massSolar: number): number {
  return massSolar * SCALE.SOLAR_MASS
}

/** Масса планеты из радиуса и типа. */
export function planetMass(radius: number, gas: boolean): number {
  const density = gas ? GRAVITY.GAS_DENSITY : GRAVITY.ROCK_DENSITY
  return density * (4 / 3) * Math.PI * radius ** 3
}

/**
 * Орбита по смещению родителя и ребёнка в t = 0.
 * Обратная задача к `orbitPoint`: phase и tilt восстанавливаются из начальной позиции.
 */
export function orbitFromOffset(
  parentId: number | null,
  parentPos: Vector3,
  childPos: Vector3,
  rate: number,
): OrbitDef {
  _offset.copy(childPos).sub(parentPos)
  const radius = _offset.length()
  if (radius < 1e-3) {
    return { parentId, radius: 0, phase: 0, rate, tilt: 0 }
  }

  // `orbitPoint` строит (R cos φ, R sin φ sin tilt, R sin φ cos tilt).
  // Поэтому фазу надо восстанавливать по длине проекции YZ, а наклон — внутри
  // самой этой плоскости. atan2(z, x) терял компонент Y и уже при t=0 сдвигал
  // наклонные планеты на тысячи километров.
  const yz = Math.hypot(_offset.y, _offset.z)
  const phase = Math.atan2(yz, _offset.x)
  const tilt = yz > 1e-9 ? Math.atan2(_offset.y, _offset.z) : 0

  return { parentId, radius, phase, rate, tilt }
}

/**
 * Точка на наклонной круговой орбите вокруг `parentPos`.
 * Родитель — позиция, не тело: барицентр двойной звезды тоже точка.
 */
export function orbitPoint(orbit: OrbitDef, parentPos: Vector3, time: number, out: Vector3): Vector3 {
  const angle = orbit.phase + orbit.rate * time
  _radial.set(Math.cos(angle) * orbit.radius, 0, Math.sin(angle) * orbit.radius)

  const cos = Math.cos(orbit.tilt)
  const sin = Math.sin(orbit.tilt)
  _out.set(_radial.x, _radial.z * sin, _radial.z * cos)

  return out.copy(parentPos).add(_out)
}

function barycentre(originOffset: Vector3): Vector3 {
  return _bary.set(0, 0, 0).sub(originOffset)
}

function parentPosFor(body: BodyEntity, bodies: BodyEntity[], originOffset: Vector3): Vector3 | null {
  const orbit = body.orbit
  if (!orbit) return null
  if (orbit.parentId === null) return barycentre(originOffset)
  return bodies.find((b) => b.id === orbit.parentId)?.pos ?? null
}

/** Расставить все орбиты на момент `time`. Порядок: барицентр → звезда → планета. */
export function stepOrbitsOnBodies(bodies: BodyEntity[], originOffset: Vector3, time: number): void {
  const passes: Array<(b: BodyEntity) => boolean> = [
    (b) => b.orbit!.parentId === null,
    (b) => {
      if (b.orbit!.parentId === null) return false
      const parent = bodies.find((p) => p.id === b.orbit!.parentId)
      return parent?.kind === 'star'
    },
    (b) => {
      if (b.orbit!.parentId === null) return false
      const parent = bodies.find((p) => p.id === b.orbit!.parentId)
      return parent?.kind === 'planet'
    },
    (b) => {
      if (b.orbit!.parentId === null) return false
      const parent = bodies.find((p) => p.id === b.orbit!.parentId)
      return parent?.kind === 'station'
    },
  ]

  for (const match of passes) {
    for (const body of bodies) {
      const orbit = body.orbit
      if (!orbit || !match(body)) continue
      const parentPos = parentPosFor(body, bodies, originOffset)
      if (!parentPos) continue
      orbitPoint(orbit, parentPos, time, body.pos)
    }
  }
}

/** Расставить орбиты на `orbitTime(world)`. */
export function stepOrbits(world: World, time = orbitTime(world)): void {
  // Игрок наследует движение ближайшего тела. У станции это станция, у поверхности
  // планеты — планета: после взлёта ни одна из них не убегает со своей орбитальной
  // скоростью, которая в локальном полёте была бы недостижима.
  const station = world.bodies.find((body) => body.kind === 'station')
  if (station) _stationBefore.copy(station.pos)
  const landingId = world.player.landedOn?.bodyId ?? null
  const boundBody = landingId !== null
    ? world.bodies.find((body) => body.id === landingId) ?? null
    : null
  // Сидим на статуе — она не body; едет со станцией, игрок должен получить ТОТ ЖЕ сдвиг.
  const boundMonolith = landingId !== null && !boundBody
    ? world.monoliths.find((m) => m.id === landingId) ?? null
    : null
  let playerReference = boundBody ?? null
  if (!playerReference && !boundMonolith) {
    let bestSurface = Infinity
    for (const body of world.bodies) {
      const surface = body.pos.distanceTo(world.player.state.pos) - body.radius
      if (surface < bestSurface) {
        bestSurface = surface
        playerReference = body
      }
    }
  }
  if (playerReference) _playerReferenceBefore.copy(playerReference.pos)

  stepOrbitsOnBodies(world.bodies, world.originOffset, time)

  if (playerReference) {
    _playerReferenceShift.copy(playerReference.pos).sub(_playerReferenceBefore)
    world.player.state.pos.add(_playerReferenceShift)
    // Игрок сдвинут НЕ своей скоростью, а орбитой опорного тела (десятки км/с у станции).
    // Камера живёт в мировых координатах и об этом сдвиге не знает — без поправки она
    // отстаёт на километры за кадр, и корабль уходит за кромку. Пишем сдвиг в тот же
    // канал `originShift`, которым камера догоняет перецентровку начала координат.
    world.originShift.add(_playerReferenceShift)
  }

  // Остальная динамическая окрестность по-прежнему рождена у станции и живёт
  // в её поступательной системе отсчёта.
  if (station) {
    _stationShift.copy(station.pos).sub(_stationBefore)
    if (_stationShift.lengthSq() < 1e-12) return
    /**
     * Список ручной — и это ВТОРАЯ такая ловушка после `maybeShiftOrigin`. Забудешь сюда новый
     * список — его объекты останутся в старых координатах, пока причал уходит по орбите вокруг
     * звезды. Время в игре сжато, поэтому «отстал» означает не метры, а АСТРОНОМИЧЕСКУЮ ЕДИНИЦУ:
     * ровно так статуи, поставленные в двадцати километрах от причала, оказывались в 500
     * световых секундах. Всё, что живёт в окрестности станции, обязано ехать вместе с ней.
     */
    for (const ship of world.ships) ship.state.pos.add(_stationShift)
    for (const asteroid of world.asteroids) asteroid.pos.add(_stationShift)
    for (const pod of world.pods) pod.pos.add(_stationShift)
    for (const missile of world.missiles) missile.pos.add(_stationShift)
    for (const bolt of world.bolts) bolt.pos.add(_stationShift)
    for (const titan of world.titans) titan.pos.add(_stationShift)
    // Статуи стоят У ПРИЧАЛА — без этой строки они и отставали на пол-системы.
    for (const monolith of world.monoliths) monolith.pos.add(_stationShift)
    // Пояс глыб держится за Люцифера — едет вместе с причалом и статуями.
    for (const rock of world.scenicRocks) rock.pos.add(_stationShift)
    for (const platform of world.platforms) platform.pos.add(_stationShift)
    for (const tracer of world.tracers) {
      tracer.from.add(_stationShift)
      tracer.to.add(_stationShift)
    }
    for (const explosion of world.explosions) explosion.pos.add(_stationShift)
    for (const warp of world.warps) warp.pos.add(_stationShift)
    for (const portal of world.warpPortals) portal.pos.add(_stationShift)
    for (const flash of world.shieldFlashes) {
      flash.pos.add(_stationShift)
      flash.center.add(_stationShift)
    }
    // Сели на статую — едем её сдвигом станции, а не орбитой чужой планеты рядом.
    if (boundMonolith) {
      world.player.state.pos.add(_stationShift)
      world.originShift.add(_stationShift)
    }
  }
}
