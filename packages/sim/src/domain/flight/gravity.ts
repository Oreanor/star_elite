import { Vector3 } from 'three'
import { GRAVITY } from '../../config/bodies'
import { isPhased } from '../cruise/drive'
import { effectiveRadius } from '../scale/scale'
import type { BodyEntity, ShipEntity, World } from '../world/entities'

/**
 * Притяжение крупных тел: a = GM/r² внутри зоны, ноль снаружи.
 *
 * Граница зоны задана общей долей радиуса. У звезды R в сто раз больше —
 * и зона в сто раз шире; крейсер начинает выход чуть раньше этой границы.
 */

const _delta = /* @__PURE__ */ new Vector3()
const _pull = /* @__PURE__ */ new Vector3()

/** Масса и зона — по звёздному масштабу B; «кора» для r — компактный горизонт. */
function gravityMassRadius(body: BodyEntity): number {
  if (body.kind === 'blackhole' && body.visualRadius) return body.visualRadius
  return body.radius
}

function gravityHorizon(body: BodyEntity): number {
  return body.radius
}

/** Высота внешней границы притяжения над поверхностью, м. */
export function gravityReach(body: BodyEntity): number {
  if (body.kind === 'station') return 0
  // Одна понятная зона для звёзд, дыр, планет и лун. Девять радиусов превращали
  // систему в сплошную гравитационную яму ещё до визуального сближения с телом.
  return gravityMassRadius(body) * GRAVITY.REACH_RADII
}

/** Масса тела из радиуса и плотности — та же формула, что у орбит лун. */
export function bodyMass(body: BodyEntity): number {
  const r = gravityMassRadius(body)
  const volume = (4 / 3) * Math.PI * r ** 3
  switch (body.kind) {
    case 'star':
      return GRAVITY.STAR_DENSITY * volume
    case 'blackhole':
      // Как звезда B до замены, чуть плотнее — не крошечный горизонт ×8.
      return GRAVITY.STAR_DENSITY * volume * 2
    case 'moon':
      return GRAVITY.ROCK_DENSITY * volume
    case 'planet':
      return (body.surface === 'Газовый гигант' ? GRAVITY.GAS_DENSITY : GRAVITY.ROCK_DENSITY) * volume
    default:
      return 0
  }
}

/** Ускорение притяжения к телу, м/с². У причала (station) — ноль. */
export function gravityAccel(ship: ShipEntity, body: BodyEntity, out: Vector3): Vector3 {
  out.set(0, 0, 0)
  if (body.kind === 'station') return out

  // `out` в основном цикле — это `_pull`, поэтому расстояние обязано жить
  // в ДРУГОМ векторе. Иначе ранний выход вне зоны возвращает само расстояние
  // как ускорение и швыряет корабль на миллиарды м/с.
  _delta.copy(body.pos).sub(ship.state.pos)
  const dist = _delta.length()
  if (dist < 1e-3) return out

  const shipR = effectiveRadius(ship)
  const horizon = gravityHorizon(body)
  const altitude = dist - gravityMassRadius(body) - shipR
  if (altitude > gravityReach(body)) return out

  const surfaceDist = horizon + shipR
  const r = Math.max(dist, surfaceDist)
  const accel = (GRAVITY.G * bodyMass(body)) / (r * r)
  return out.copy(_delta).multiplyScalar(accel / dist)
}

/**
 * На орбите станции корабль держит орбитальная автоматика. К планете начинает
 * ронять лишь ниже половины высоты станции: это и заметный спуск, и понятная граница.
 */
function protectedStationOrbit(ship: ShipEntity, body: BodyEntity, world: World): boolean {
  if (body.kind !== 'planet' && body.kind !== 'moon') return false
  const station = world.bodies.find(
    (candidate) => candidate.kind === 'station' && candidate.orbit?.parentId === body.id,
  )
  if (!station?.orbit) return false

  const stationAltitude = Math.max(0, station.orbit.radius - body.radius)
  const shipAltitude =
    body.pos.distanceTo(ship.state.pos) - body.radius - effectiveRadius(ship)
  return shipAltitude >= stationAltitude * 0.5
}

/** Шаг притяжения: добавляет ускорение к скорости корабля. */
export function stepGravity(ship: ShipEntity, world: World, dt: number): void {
  if (isPhased(ship)) return

  for (const body of world.bodies) {
    if (protectedStationOrbit(ship, body, world)) continue
    gravityAccel(ship, body, _pull)
    if (_pull.lengthSq() < 1e-12) continue
    ship.state.vel.addScaledVector(_pull, dt)
  }
}
