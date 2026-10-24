import { Vector3 } from 'three'
import { GRAVITY } from '../../config/bodies'
import { SCALE } from '../../config/galaxy'
import { orbitSec } from '../../config/time'
import type { BodyEntity, OrbitDef, WarBaseEntity, World } from './entities'
import { shiftTrail } from './poseTrail'
import { translateNeighborhood, translatePlayer } from './frame'

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
const _stationShift = /* @__PURE__ */ new Vector3()
const _playerReferenceShift = /* @__PURE__ */ new Vector3()
const _baseBefore = /* @__PURE__ */ new Vector3()
const _baseParent = /* @__PURE__ */ new Vector3()

/**
 * Светило системы — звезда или дыра, вокруг которой (или вокруг барицентра пары) всё
 * обращается. Не светило: декоративная тесная пара (`faint`) и дыра, привязанная к
 * станции (Дверь). Различаем по орбите, а не по виду: иначе Дверь у причала становилась
 * «компаньоном» солнца, и якорь галактики уезжал на полпути между ними.
 */
export function isLuminary(b: BodyEntity): boolean {
  return (b.kind === 'star' || b.kind === 'blackhole') && !b.faint && (b.orbit == null || b.orbit.parentId == null)
}

/** `n`-е светило (0 — главное, 1 — компаньон двойной) или null. Без аллокаций: зовётся в кадре. */
export function luminary(bodies: readonly BodyEntity[], n: number): BodyEntity | null {
  let k = 0
  for (const b of bodies) {
    if (!isLuminary(b)) continue
    if (k === n) return b
    k++
  }
  return null
}

/** Момент для орбит: общие физические секунды с серверного якоря. */
export function orbitTime(world: World): number {
  return orbitSec(world.calendarTime)
}

/** ω вокруг точки массы M на радиусе r, рад/с. */
export function keplerRate(centralMass: number, orbitRadius: number): number {
  return Math.sqrt((GRAVITY.G * centralMass) / orbitRadius ** 3)
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

/**
 * Места тел ДО шага орбит — чтобы знать, на сколько уехало каждое. Буфер растёт до числа тел
 * один раз и дальше переиспользуется: шаг идёт каждый такт.
 */
const _before: Vector3[] = []

/** Сдвиг тела `index` за этот шаг орбит. Звать после `stepOrbitsOnBodies`. */
function bodyShift(world: World, index: number, out: Vector3): Vector3 {
  const body = world.bodies[index]
  const before = _before[index]
  return body && before ? out.copy(body.pos).sub(before) : out.set(0, 0, 0)
}

/**
 * С каким телом едет игрок — индекс в `world.bodies`, −1 — ни с каким.
 *
 * Сел — с тем, на чём сидит: тело — само тело, военная база — причал (базы стоят у него).
 * Летит — с ближайшим по поверхности: после взлёта ни станция, ни планета не убегают
 * со своей орбитальной скоростью, недостижимой в локальном полёте. Камень опорой не бывает:
 * он сам часть окрестности и едет с той же опорой.
 */
/**
 * Опора игрока: тело (индекс в `world.bodies`) или военная база (её собственный ход — у базы
 * со своей орбитой ни одно тело не едет так же). Ничего — `{ body: −1, base: null }`.
 */
interface PlayerFrame {
  body: number
  base: WarBaseEntity | null
}
const _frame: PlayerFrame = { body: -1, base: null }

/** База едет с якорем, причалом или своей орбитой; опора на неё — то же, что опора на это. */
function frameOfBase(world: World, base: WarBaseEntity, stationIndex: number): PlayerFrame {
  _frame.base = null
  _frame.body = -1
  if (base.orbit) _frame.base = base
  else {
    const anchor = base.anchorId == null ? -1 : world.bodies.findIndex((b) => b.id === base.anchorId)
    _frame.body = anchor >= 0 ? anchor : stationIndex
  }
  return _frame
}

function playerFrame(world: World, stationIndex: number): PlayerFrame {
  const landedId = world.player.landedOn?.bodyId ?? null
  if (landedId !== null) {
    const body = world.bodies.findIndex((b) => b.id === landedId)
    if (body >= 0) {
      _frame.body = body
      _frame.base = null
      return _frame
    }
    const base = world.warBases.find((r) => r.id === landedId)
    if (base) return frameOfBase(world, base, stationIndex)
  }
  let best = -1
  let bestSurface = Infinity
  const pos = world.player.state.pos
  for (let i = 0; i < world.bodies.length; i++) {
    const body = world.bodies[i]!
    const surface = body.pos.distanceTo(pos) - body.radius
    if (surface < bestSurface) {
      bestSurface = surface
      best = i
    }
  }
  // База ближе любого тела — опора она: у разбитой планеты её бывший причал ушёл на свою
  // орбиту, и, держась его, игрок уезжал от базы, к которой летел.
  let nearBase: WarBaseEntity | null = null
  for (const base of world.warBases) {
    const surface = base.pos.distanceTo(pos) - base.radius
    if (surface < bestSurface) {
      bestSurface = surface
      nearBase = base
    }
  }
  if (nearBase) return frameOfBase(world, nearBase, stationIndex)
  _frame.body = best
  _frame.base = null
  return _frame
}

/**
 * Расставить орбиты на `orbitTime(world)` и провезти всё, что едет с телами.
 *
 * СИСТЕМЫ ОТСЧЁТА — одно правило: каждый объект едет с телом, к которому привязан.
 *  • ПРИЧАЛ (первая станция системы): статуи двора и военные базы стоят у него.
 *  • ЯКОРЬ статуэтки (`anchorId`): поставленная из трюма едет с телом, у которого её поставили;
 *    без якоря — висит в системе звезды, как и родилась.
 *  • ОПОРА ИГРОКА (`playerFrame`): тело или военная база рядом; игрок и вся окрестность (`translateNeighborhood`) —
 *    они рождаются и живут вокруг него и обязаны ехать с ним одной системой отсчёта.
 *
 * Прежде окрестность ехала с первой станцией, а игрок — со своей опорой: у аванпоста со своей
 * орбитой всё вокруг проносилось мимо с разницей в сотни километров за такт.
 */
export function stepOrbits(world: World, time = orbitTime(world)): void {
  const bodies = world.bodies
  while (_before.length < bodies.length) _before.push(new Vector3())
  for (let i = 0; i < bodies.length; i++) _before[i]!.copy(bodies[i]!.pos)
  const stationIndex = bodies.findIndex((b) => b.kind === 'station')
  const frame = playerFrame(world, stationIndex)
  const frameBody = frame.body
  const frameBase = frame.base
  if (frameBase) _baseBefore.copy(frameBase.pos)

  stepOrbitsOnBodies(bodies, world.originOffset, time)

  // Причал: статуи двора и пояс баз Люцифера.
  if (stationIndex >= 0) {
    bodyShift(world, stationIndex, _stationShift)
    if (_stationShift.lengthSq() >= 1e-12) {
      for (const monolith of world.monoliths) monolith.pos.add(_stationShift)
      for (const rock of world.warBases) if (rock.anchorId == null && !rock.orbit) rock.pos.add(_stationShift)
    }
  }

  // Базы у планет — ходом своей планеты; базы разбитой планеты — по своей орбите.
  for (const rock of world.warBases) {
    if (rock.orbit) {
      const pid = rock.orbit.parentId
      const parent = pid === null ? barycentre(world.originOffset) : bodies.find((b) => b.id === pid)?.pos
      if (parent) orbitPoint(rock.orbit, _baseParent.copy(parent), time, rock.pos)
      continue
    }
    if (rock.anchorId == null) continue
    const anchor = bodies.findIndex((b) => b.id === rock.anchorId)
    if (anchor >= 0) rock.pos.add(bodyShift(world, anchor, _offset))
  }

  // Статуэтки с якорем — ходом своего тела (это и есть их ход, его показ интерполирует след).
  for (const figurine of world.figurines) {
    if (figurine.anchorId == null) continue
    const anchor = bodies.findIndex((b) => b.id === figurine.anchorId)
    if (anchor >= 0) figurine.pos.add(bodyShift(world, anchor, _offset))
  }

  let local: Vector3
  if (frameBase) local = _playerReferenceShift.copy(frameBase.pos).sub(_baseBefore)
  else if (frameBody >= 0) local = bodyShift(world, frameBody, _playerReferenceShift)
  else return
  if (local.lengthSq() < 1e-12) return
  /**
   * Перенос опорой — СМЕНА СИСТЕМЫ ОТСЧЁТА, а не ход: игрок и окрестность едут с опорой разом,
   * и следы поз — вместе с ними. Камера живёт в мировых координатах и об этом не знает: сдвиг
   * идёт ей тем же каналом `originShift`, что и перецентровка начала координат.
   */
  translatePlayer(world, local)
  translateNeighborhood(world, local)
  world.originShift.add(local)
  /**
   * Следы ВСЕХ тел — этим же сдвигом. Игрок с камерой переезжают его разом, значит и тела
   * обязаны показывать между тактами лишь ход ОТНОСИТЕЛЬНО опоры. Прежде сдвиг получали
   * только опора и причал: прочие тела тянули его долей такта, и относительно камеры их
   * носило пилой на сотни метров за такт — дыра «Дверь» в 60 км от причала дрожала.
   */
  for (const body of bodies) shiftTrail(body, local)
  // Статуэтки — так же, как тела: между тактами виден лишь их ход относительно опоры.
  for (const figurine of world.figurines) shiftTrail(figurine, local)
}
