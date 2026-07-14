import { Vector3 } from 'three'
import { GRAVITY } from '../../config/bodies'
import { orbitSec } from '../../config/time'
import { clamp } from '../../core/math'
import type { BodyEntity, OrbitDef, World } from './entities'

/**
 * Орбиты тел: угол = phase + rate·t, позиция считается заново каждый шаг.
 *
 * Часы — игровой календарь: `orbitSec(world.calendarTime)` (× `TIME.SCALE`).
 * `world.calendarTime` — общие «реальные» секунды с якоря; орбиты идут в темпе HUD.
 * Не `world.time`: тот замирает в доке и локален физике. Два клиента и вход в
 * систему через год игры обязаны увидеть одну и ту же расстановку.
 *
 * Планеты, луны, станции и звёзды двойной — ω = √(GM/r³), периоды не назначаются.
 */

const _radial = /* @__PURE__ */ new Vector3()
const _out = /* @__PURE__ */ new Vector3()
const _bary = /* @__PURE__ */ new Vector3()
const _offset = /* @__PURE__ */ new Vector3()

/** Момент для орбит: секунды игрового календаря (HUD и сутки × SCALE). */
export function orbitTime(world: World): number {
  return orbitSec(world.calendarTime)
}

/** ω вокруг точки массы M на радиусе r, рад/с. */
export function keplerRate(centralMass: number, orbitRadius: number): number {
  return Math.sqrt((GRAVITY.G * centralMass) / orbitRadius ** 3)
}

/** Масса звезды из радиуса. */
export function starMass(radius: number): number {
  return GRAVITY.STAR_DENSITY * (4 / 3) * Math.PI * radius ** 3
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

  const phase = Math.atan2(_offset.z, _offset.x)
  const sinP = Math.sin(phase)
  const cosP = Math.cos(phase)
  let tilt = 0
  if (Math.abs(sinP) > 1e-4) {
    tilt = Math.asin(clamp(_offset.y / (radius * sinP), -1, 1))
  } else if (Math.abs(cosP) > 1e-4) {
    tilt = Math.asin(clamp(_offset.y / (radius * cosP), -1, 1))
  }

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
  stepOrbitsOnBodies(world.bodies, world.originOffset, time)
}
