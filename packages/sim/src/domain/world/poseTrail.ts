import { Quaternion, Vector3 } from 'three'
import { PHYSICS } from '../../config/physics'
import type { World } from './entities'

/**
 * СЛЕД ПОЗЫ: где тело было до последнего такта и где оказалось после него.
 *
 * Мир шагает ровными тактами (`FIXED_DT`), а кадр приходит когда придётся: на 144 Гц в
 * одном кадре такт есть, в другом нет. Покажи рендер голую позу — тела дёргаются рывками
 * «шаг, стоим, шаг». Поэтому рендер показывает ПРОМЕЖУТОЧНУЮ позу: между позой до такта и
 * после него, на долю остатка накопителя (`world.renderAlpha`). Картинка отстаёт от
 * симуляции не больше чем на такт — 8 мс, — зато движение ровное при любой герцовке.
 *
 * След хранится сбоку (WeakMap по вектору позы), а не полем сущности: заводить его не надо
 * ни в одной фабрике, умершее тело уносит его с собой, а новорождённое без следа просто
 * рисуется как есть.
 *
 * ТЕЛЕПОРТ снаружи такта (прыжок, отчаливание, портал, перенос редактором) распознаётся сам:
 * поза не совпала с той, что оставил последний такт, — значит её переставили, и тянуть её
 * от старого места нельзя. Ни одно место, переставляющее тело, не обязано об этом помнить.
 */

/** Всё, у чего есть место в мире; ориентация — у тех, кто вертится. */
export interface Posed {
  pos: Vector3
  quat?: Quaternion
}

/**
 * След ведётся по САМОМУ вектору позиции (и отдельно — кватерниону), а не по сущности: тогда
 * любой, кто держит ссылку на `pos` (метка HUD, цель навигации, подпись карты), покажет её
 * между тактами, не разыскивая, чья это позиция.
 */
interface PosTrail {
  prev: Vector3
  last: Vector3
}
interface QuatTrail {
  prev: Quaternion
  last: Quaternion
}

const posTrails = new WeakMap<Vector3, PosTrail>()
const quatTrails = new WeakMap<Quaternion, QuatTrail>()

/**
 * Всё, что двигается в такте. Неподвижное (статуи, базы — их спин идёт от времени) сюда не
 * входит: ему нечего интерполировать, кроме времени, а время — `renderTime`.
 */
function forEachMoving(world: World, fn: (p: Posed) => void): void {
  fn(world.player.state)
  for (const s of world.ships) fn(s.state)
  for (const a of world.asteroids) fn(a)
  for (const p of world.pods) fn(p)
  for (const m of world.missiles) fn(m)
  for (const b of world.bolts) fn(b)
  for (const b of world.bodies) fn(b)
  for (const t of world.titans) fn(t)
  for (const p of world.platforms) fn(p)
  for (const f of world.figurines) fn(f)
}

// Обходчики — на уровне модуля: зовутся каждый такт, и замыкание на вызов было бы мусором.
const snapOne = (p: Posed): void => {
  const t = posTrails.get(p.pos)
  if (t && !t.last.equals(p.pos)) {
    t.prev.copy(p.pos)
    t.last.copy(p.pos)
  }
  if (!p.quat) return
  const q = quatTrails.get(p.quat)
  if (q && !q.last.equals(p.quat)) {
    q.prev.copy(p.quat)
    q.last.copy(p.quat)
  }
}
const beginOne = (p: Posed): void => {
  let t = posTrails.get(p.pos)
  if (!t) posTrails.set(p.pos, (t = { prev: p.pos.clone(), last: p.pos.clone() }))
  t.prev.copy(p.pos)
  if (!p.quat) return
  let q = quatTrails.get(p.quat)
  if (!q) quatTrails.set(p.quat, (q = { prev: p.quat.clone(), last: p.quat.clone() }))
  q.prev.copy(p.quat)
}
const endOne = (p: Posed): void => {
  posTrails.get(p.pos)?.last.copy(p.pos)
  if (p.quat) quatTrails.get(p.quat)?.last.copy(p.quat)
}

/** Начало кадра: переставленное снаружи — «прибить» след к новому месту, без протяжки. */
export function snapMovedTrails(world: World): void {
  forEachMoving(world, snapOne)
}

/** Начало такта: нынешняя поза становится «прошлой». */
export function beginTrailTick(world: World): void {
  forEachMoving(world, beginOne)
}

/** Конец кадра: запомнить позу, оставленную тактами, — по ней узнаётся телепорт. */
export function endTrailFrame(world: World): void {
  forEachMoving(world, endOne)
}

/**
 * Сдвиг плавающего начала координат: следы едут вместе с телами. Иначе в кадр сдвига
 * тело протянулось бы от старых координат к новым — через весь мир.
 */
export function shiftTrail(p: Posed, shift: Vector3): void {
  const t = posTrails.get(p.pos)
  if (!t) return
  t.prev.add(shift)
  t.last.add(shift)
}

/**
 * Где ПОКАЗАТЬ точку `pos` в этом кадре. Годится любая ссылка на позицию тела; без следа
 * (неподвижное, новорождённое) или после телепорта — где она есть.
 */
export function shownPosition(world: World, pos: Vector3, out: Vector3): Vector3 {
  const t = posTrails.get(pos)
  if (!t || !t.last.equals(pos)) return out.copy(pos)
  return out.lerpVectors(t.prev, pos, world.renderAlpha)
}

/** Где ПОКАЗАТЬ тело в этом кадре. */
export function renderPos(world: World, p: Posed, out: Vector3): Vector3 {
  return shownPosition(world, p.pos, out)
}

/** Как ПОКАЗАТЬ ориентацию тела в этом кадре. */
export function renderQuat(world: World, p: Posed & { quat: Quaternion }, out: Quaternion): Quaternion {
  const q = quatTrails.get(p.quat)
  if (!q || !q.last.equals(p.quat)) return out.copy(p.quat)
  return out.slerpQuaternions(q.prev, p.quat, world.renderAlpha)
}

/**
 * Время, которому соответствует показанная картинка. Всё, что рендер выводит из времени
 * (спин базы, фаза орбиты, возраст вспышки), обязано брать его, а не `world.time`: иначе
 * деталь, посчитанная по времени, разойдётся с телом, показанным по следу.
 */
export function renderTime(world: World): number {
  return world.time - (1 - world.renderAlpha) * PHYSICS.FIXED_DT
}
