import { Vector3 } from 'three'
import { BELT } from '../../config/belt'
import { FAUNA_SPECIES, PLANET_COLORS } from '../../config/galaxy'
import { COSMIC } from '../../config/weapons'
import { orbitSec } from '../../config/time'
import { pushEdit, type FateEdit } from '../galaxy/delta'
import { makeAsteroidBelt } from './asteroidBelt'
import type { BodyEntity, Cataclysm, OrbitDef, World } from './entities'
import { orbitFromOffset, orbitTime, stepOrbitsOnBodies } from './orbits'

/**
 * СУДЬБЫ ТЕЛ — итог космических лазеров в мире: засеянный мир, разбитая планета, луна,
 * звезда. Источник правды — журнал галактики (`FateEdit`): он общий для всех игроков, и
 * мир лишь сверяет себя с ним (`reconcileFates`). Свой выстрел и чужой, пришедший по сети,
 * идут одной дорогой — правка в журнал, сверка в такте. Вход в систему сверяет журнал с
 * начала, поэтому разбитое остаётся разбитым и через год, и у того, кто прилетел позже.
 *
 * Что остаётся от тела — правило мира, а не выбор стрелка:
 *  • скала/лёд/океан — пояс обломков ЦЕЛИКОМ на её орбите;
 *  • луна — ДУГА пояса (сектор ~30°) на орбите вокруг своей планеты: обломкам не растечься;
 *  • газовый гигант и звезда — рассеиваются, обломков нет;
 *  • чёрная дыра — безразлична.
 * Кто кружил вокруг погибшего (луны, причал, компаньон тесной пары) — остаётся на своём
 * удалении, но теперь вокруг его хозяина (звезды), с тем же темпом Кеплера.
 */

const _parentAt = new Vector3()
const _childAt = new Vector3()
const _bary = new Vector3()
const _zero = new Vector3()

/** Записать судьбу в журнал галактики (и в очередь сети). Сверка мира — следом, в такте. */
export function commitFate(world: World, body: BodyEntity, fate: FateEdit['fate']): boolean {
  // Комната-монумент не принадлежит галактике: у её тел нет адреса в журнале.
  if (!body.ref || world.inMonument || world.systemIndex < 0) return false
  const edit: FateEdit = { op: 'fate', index: world.systemIndex, ref: body.ref, fate, at: world.calendarTime }
  pushEdit(world.galaxyDelta, edit)
  world.galaxyEpoch++
  world.galaxyEditsOut.push({ seed: world.galaxySeed, edit })
  reconcileFates(world)
  return true
}

/** Сверить тела системы с новыми записями журнала. Звать в такте и после входа в систему. */
export function reconcileFates(world: World): void {
  const edits = world.galaxyDelta.edits
  // Журнал откатили — разбитое не собрать обратно; сверяем заново лишь то, что есть.
  if (world.fateCursor > edits.length) world.fateCursor = edits.length
  if (world.inMonument) {
    world.fateCursor = edits.length
    return
  }
  for (; world.fateCursor < edits.length; world.fateCursor++) {
    const e = edits[world.fateCursor]!
    if (e.op !== 'fate' || e.index !== world.systemIndex) continue
    applyFate(world, e, Math.abs(world.calendarTime - e.at) < COSMIC.FRESH)
  }
}

function applyFate(world: World, e: FateEdit, fresh: boolean): void {
  const body = world.bodies.find((b) => b.ref === e.ref)
  if (!body) return
  if (e.fate === 'seed') seedLife(world, body, fresh)
  else shatter(world, body, e.at, fresh)
}

/**
 * Судьбы системы на голых телах — без мира, без поясов и зрелищ: расчётная раскладка
 * (`layoutSystemBodies`) для точки выхода из прыжка. Те же правила, что и в живом мире,
 * поэтому причал разбитой планеты ищется там, где он кружит теперь, а не где кружил бы.
 */
export function applyFatesToBodies(bodies: BodyEntity[], fates: readonly FateEdit[], tNow: number): void {
  if (fates.length === 0) return
  const off = _zero
  for (const e of fates) {
    const body = bodies.find((b) => b.ref === e.ref)
    if (!body) continue
    if (e.fate === 'seed') {
      seedBody(body)
      continue
    }
    if (!shatterable(body)) continue
    stepOrbitsOnBodies(bodies, off, orbitSec(e.at))
    releaseOrphans(bodies, off, body, orbitSec(e.at))
    bodies.splice(bodies.indexOf(body), 1)
  }
  stepOrbitsOnBodies(bodies, off, tNow)
}

/** Первобытная жизнь на необитаемой тверди. Газ, звезда и живой мир — без перемен. */
function seedBody(body: BodyEntity): boolean {
  if (body.kind !== 'planet' || body.settlement || body.surface === 'Газовый гигант') return false
  body.settlement = { economy: 'Аграрная', government: 'Анархия', techLevel: 1, population: 0.05, species: FAUNA_SPECIES }
  body.population = 0.05
  // Голый камень и лёд зеленеют; океан остаётся океаном — жизнь в нём, а не на суше.
  if (body.surface === 'Скалистая' || body.surface === 'Ледяная') {
    body.surface = 'Земного типа'
    body.color = PLANET_COLORS['Земного типа']
  }
  return true
}

function seedLife(world: World, body: BodyEntity, fresh: boolean): void {
  if (!seedBody(body)) return
  world.bodiesRevision++
  if (!fresh) return
  // Свежая — лёгкая вспышка и весть: «на планете такой-то появилась жизнь». У всех в системе.
  addCataclysm(world, body, 'seed')
  world.notices.push({ kind: 'life', name: body.name, at: world.time })
}

function shatterable(body: BodyEntity): boolean {
  return body.kind !== 'blackhole' && body.kind !== 'station'
}

function shatter(world: World, body: BodyEntity, at: number, fresh: boolean): void {
  if (!shatterable(body)) return
  const kind: Cataclysm['kind'] = body.kind === 'star' ? 'star' : body.surface === 'Газовый гигант' ? 'gas' : 'rock'

  world.fallen.push({
    ref: body.ref ?? String(body.id),
    name: body.name,
    kind: body.kind === 'moon' ? 'moon' : body.kind === 'star' ? 'star' : 'planet',
    surface: body.surface,
    populated: body.population > 0,
    remains: kind !== 'rock' ? 'none' : body.kind === 'moon' ? 'arc' : 'belt',
    at,
    stations: world.bodies.filter((b) => b.kind === 'station' && b.orbit?.parentId === body.id).map((b) => b.name),
  })

  // Орбиты — на миг гибели: кто кружил вокруг тела, встаёт на новую орбиту ОТТУДА, где его
  // застал взрыв. Одинаково у всех клиентов и при любом позднем входе (миг — из журнала).
  const off = world.originOffset
  const tAt = orbitSec(at)
  stepOrbitsOnBodies(world.bodies, off, tAt)

  // Одиночная звезда уносит с собой сферу Дайсона.
  if (releaseOrphans(world.bodies, off, body, tAt)) world.dyson = null

  if (kind === 'rock') addDebrisBelt(world, body, tAt)
  if (fresh) addCataclysm(world, body, kind)

  world.bodies.splice(world.bodies.indexOf(body), 1)
  forget(world, body.id)
  // Назад к настоящему моменту — уже без погибшего.
  stepOrbitsOnBodies(world.bodies, off, orbitTime(world))
  world.bodiesRevision++
}

/** Детей погибшего — новым хозяевам. true — погибла одиночная звезда. */
function releaseOrphans(bodies: BodyEntity[], off: Vector3, dead: BodyEntity, t: number): boolean {
  if (dead.kind === 'star') return loseStar(bodies, off, dead, t)
  adoptOrphans(bodies, off, dead, t)
  return false
}

/** Позиция родителя орбиты (тело или барицентр) на текущей расстановке. */
function parentPos(bodies: readonly BodyEntity[], off: Vector3, parentId: number | null, out: Vector3): Vector3 | null {
  if (parentId === null) return out.set(0, 0, 0).sub(off)
  const p = bodies.find((b) => b.id === parentId)
  return p ? out.copy(p.pos) : null
}

/**
 * Орбита вокруг `parentId` через точку `childPos` в миг `t`: фаза сдвинута так, чтобы
 * в этот миг тело стояло ровно там, где стоит (`orbitFromOffset` даёт фазу на t = 0).
 */
function orbitThrough(parentId: number | null, parent: Vector3, childPos: Vector3, rate: number, t: number): OrbitDef {
  const orbit = orbitFromOffset(parentId, parent, childPos, rate)
  orbit.phase -= rate * t
  return orbit
}

/**
 * Дети погибшего (луны, причал, компаньон тесной пары) — к его хозяину, на своём удалении.
 * Темп — Кеплер вокруг ТОЙ ЖЕ центральной массы, что держала погибшего: ω ∝ r^(−3/2) от
 * его орбиты. У тела без хода (декорация у причала, rate 0) дети тоже стоят на смещении.
 */
function adoptOrphans(bodies: BodyEntity[], off: Vector3, dead: BodyEntity, t: number): void {
  const grand = dead.orbit
  if (!grand) return
  const parent = parentPos(bodies, off, grand.parentId, _parentAt)
  if (!parent) return
  for (const child of bodies) {
    if (child.orbit?.parentId !== dead.id) continue
    _childAt.copy(child.pos)
    const r = _childAt.distanceTo(parent)
    const rate = grand.radius > 0 && r > 0 ? grand.rate * (grand.radius / r) ** 1.5 : 0
    child.orbit = orbitThrough(grand.parentId, parent, _childAt, rate, t)
  }
}

/**
 * Гибель светила. Три разных случая, а не один:
 *  • ОДИНОЧНАЯ звезда — планеты кружат вокруг пустого барицентра (там, где была звезда),
 *    прежним темпом; сфера Дайсона гибнет с ней;
 *  • звезда ДВОЙНОЙ — выживший партнёр лишился пары и встаёт там, где его застал взрыв
 *    (без пары кружить вокруг барицентра нечего); планеты двойной и так у барицентра;
 *  • звезда ТЕСНОЙ ПАРЫ с перетеканием — поток рвётся (не с кого и не на кого течь),
 *    компаньон донора остаётся на смещении у причала (см. `adoptOrphans`).
 * Возвращает true для одиночной: вызывающий гасит её сферу Дайсона.
 */
function loseStar(bodies: BodyEntity[], off: Vector3, star: BodyEntity, t: number): boolean {
  // Поток вещества — с погибшей и на погибшую.
  for (const b of bodies) {
    if (b.streamTo === star.id) {
      b.streamTo = undefined
      b.streamStyle = undefined
    }
  }

  if (star.faint) {
    adoptOrphans(bodies, off, star, t)
    return false
  }

  const binary = star.orbit !== null && star.orbit.parentId === null
  if (binary) {
    // Партнёр — второе светило у барицентра. Встаёт на месте: орбита с нулевым ходом.
    for (const b of bodies) {
      if (b === star || b.faint || (b.kind !== 'star' && b.kind !== 'blackhole')) continue
      if (!b.orbit || b.orbit.parentId !== null) continue
      parentPos(bodies, off, null, _bary)
      b.orbit = orbitThrough(null, _bary, b.pos, 0, t)
    }
    return false
  }
  // Одиночная: её дети — к барицентру (он и был её местом), темп прежний.
  parentPos(bodies, off, null, _bary)
  for (const child of bodies) {
    if (child.orbit?.parentId !== star.id) continue
    child.orbit = orbitThrough(null, _bary, child.pos, child.orbit.rate, t)
  }
  return true
}

/** Камни пояса — из зерна системы и адреса тела: у всех клиентов один и тот же пояс. */
function beltSeed(world: World, ref: string): number {
  let h = (world.galaxySeed ^ Math.imul(world.systemIndex + 1, 0x9e3779b1)) >>> 0
  for (let i = 0; i < ref.length; i++) h = Math.imul(h ^ ref.charCodeAt(i), 0x01000193) >>> 0
  return h
}

/**
 * Пояс обломков на орбите погибшего: планета — кольцо целиком, луна — дуга вокруг своей
 * планеты, с серединой там, где луну застал импульс.
 */
function addDebrisBelt(world: World, dead: BodyEntity, t: number): void {
  const orbit = dead.orbit
  if (!orbit || orbit.radius <= 0) return
  const centre = new Vector3()
  if (!parentPos(world.bodies, world.originOffset, orbit.parentId, centre)) return
  centre.add(world.originOffset)
  const moon = dead.kind === 'moon'
  const belt = makeAsteroidBelt(world.ids, {
    seed: beltSeed(world, dead.ref ?? String(dead.id)),
    center: centre,
    parentId: orbit.parentId,
    radius: orbit.radius,
    tilt: orbit.tilt,
    arc: null,
    diameter: moon ? COSMIC.MOON_BELT_DIAMETER : COSMIC.PLANET_BELT_DIAMETER,
    count: moon ? COSMIC.MOON_BELT_COUNT : COSMIC.PLANET_BELT_COUNT,
  })
  if (moon) {
    // Середина дуги — угол луны на её орбите в миг гибели, во вращающемся угле пояса.
    const angle = orbit.phase + orbit.rate * t
    belt.arc = { mid: angle - (world.time * BELT.DRIFT_SPEED) / orbit.radius, half: COSMIC.MOON_ARC_HALF }
  }
  world.asteroidBelts.push(belt)
}

/** Погибшее тело больше не цель ни для навигации, ни для захвата, ни для посадки. */
function forget(world: World, id: number): void {
  if (world.navTargetId === id) world.navTargetId = null
  if (world.contactLock?.id === id) world.contactLock = null
  if (world.player.landedOn?.bodyId === id) world.player.landedOn = null
}

function addCataclysm(world: World, body: BodyEntity, kind: Cataclysm['kind']): void {
  world.cataclysms.push({
    kind,
    at: body.pos.clone().add(world.originOffset),
    radius: body.radius,
    color: body.color,
    axis: body.spinAxis.clone(),
    born: world.time,
  })
}

/** Зрелища гибели гаснут по возрасту — такт мира, не кадр. */
export function stepCataclysms(world: World): void {
  const list = world.cataclysms
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]!
    if (world.time - c.born > COSMIC.LIFE[c.kind]!) list.splice(i, 1)
  }
}
