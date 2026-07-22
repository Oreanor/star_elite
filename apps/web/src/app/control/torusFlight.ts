import { Vector3, type Quaternion } from 'three'
import {
  identity4,
  mul4,
  orthonormalize4,
  rotPlaneW,
  type Pose4,
} from '../../render/scene/hypertorus'
import { TORUS } from '../../render/config'
import { isHeld } from '../../platform/input/input'
import { finishTorusApproach, torusAutopilotActive, torusNav } from './torusAutopilot'

/**
 * ПОЛЁТ ПО ГИПЕРТОРУ. Корабль стоит в центре стереопроекции и вертится мышью (это делает
 * обычная физика поворота), а W/S/ПКМ ГОНЯТ всю вселенную S³ сквозь тебя. Здесь копится
 * «вид» — изометрия V, которой слой рендера двигает решётку каждый кадр.
 *
 * Поток — поворот S³ в плоскости (нос корабля, w): точки утекают к полюсу проекции и
 * возвращаются, узор выворачивается. Тяга вперёд наращивает V поворотом по направлению носа;
 * нос берём из ориентации корабля, поэтому куда смотришь — туда и летишь. S³ замкнута —
 * лететь можно бесконечно, придёшь к себе же.
 *
 * Живёт в app/control (можно читать ввод). Слой рендера зовёт `stepTorusFlight` каждый кадр и
 * читает `torusView()` — тот же шов, что у портала прыжка.
 */

const view: Pose4 = identity4()
const _step: Pose4 = new Float64Array(16)
const _fwd = new Vector3()
const _zBack = new Vector3(0, 0, -1)

/** Сектор газа 0..1, как в мире: W плавно наращивает, S убавляет, держится сам. */
let throttle = 0

/** Сбросить вид в единицу. Игрок оказывается в точке (0,0,0,−1) — центре проекции. */
export function resetTorusFlight(): void {
  identity4(view)
  throttle = 0
}

/**
 * ВСТАТЬ В УЗЕЛ: подобрать позу так, чтобы точка S³ `v` пришла в центр проекции (0,0,0,−1),
 * то есть оказалась ровно под игроком.
 *
 * Нужно на входе в комнату: влетел в дыру своей галактики — стоишь в СВОЁМ узле, а соседи
 * вокруг тебя действительно соседи. При единичной позе игрок стоял в точке, которая узлом
 * не является вовсе, и «дом» болтался в стороне без всякой причины.
 *
 * Поворот берём в плоскости (пространственное направление v, w): он переводит пару
 * (|v_xyz|, v_w) из её угла α в −π/2, то есть ровно в антипод полюса.
 */
export function placeTorusAt(x: number, y: number, z: number, w: number): void {
  throttle = 0
  const s = Math.hypot(x, y, z)
  if (s < 1e-9) {
    // Точка на самой оси w: направление поворота произвольно, важен только угол.
    identity4(view)
    if (w > 0) rotPlaneW(0, 0, -1, Math.PI, view)
    return
  }
  rotPlaneW(x / s, y / s, z / s, Math.atan2(w, s) + Math.PI / 2, view)
}

export function torusView(): Pose4 {
  return view
}

/** Текущий газ сквозь тор (0..1) — им же питается прибор ТЯГА на HUD. */
export function torusThrust(): number {
  return throttle
}

/**
 * Шаг полёта за `dt`. Нос корабля (`shipQuat`·−z) задаёт направление потока; W/S — вперёд/назад,
 * ПКМ — форсаж. Накопление СЛЕВА: V ← Bᵀ·V, где B — поворот по носу (так решётка двигается как
 * ОБРАТНОЕ к перемещению игрока — он будто летит вперёд сквозь неё).
 */
export function stepTorusFlight(shipQuat: Quaternion, dt: number): void {
  _fwd.copy(_zBack).applyQuaternion(shipQuat)

  if (torusAutopilotActive()) {
    // Автопилот ведёт газ: прибыл — гасим и снимаем автопилот (штурвал возвращается мыши);
    // иначе даём ход, как только нос совпал с направлением на цель.
    const nav = torusNav()
    if (nav.arrived) {
      throttle -= TORUS.THROTTLE_RATE * dt
      if (throttle <= 0) {
        throttle = 0
        // Штурвал — мыши, а вершина уходит на выдачу: `stepBush` выбросит из дыры в галактику.
        finishTorusApproach()
      }
    } else if (nav.valid && _fwd.x * nav.dx + _fwd.y * nav.dy + _fwd.z * nav.dz > TORUS.AUTOPILOT_AIM_DOT) {
      throttle += TORUS.THROTTLE_RATE * dt
    } else {
      // Нос ещё доворачивается на цель — ход притормаживаем, чтобы не промахнуться.
      throttle -= TORUS.THROTTLE_RATE * dt
    }
  } else {
    // Газ — обычный СЕКТОР: W наращивает, S убавляет, отпустил — держится. Тот же темп, что у пилота.
    if (isHeld('KeyW')) throttle += TORUS.THROTTLE_RATE * dt
    if (isHeld('KeyS')) throttle -= TORUS.THROTTLE_RATE * dt
  }
  throttle = throttle < 0 ? 0 : throttle > 1 ? 1 : throttle

  if (throttle > 1e-4) {
    // Знак проверен численно (signcheck): при +angle галактика ПО НОСУ приближается — летим В неё.
    const angle = throttle * TORUS.FLY_RATE * dt
    rotPlaneW(_fwd.x, _fwd.y, _fwd.z, angle, _step)
    mul4(_step, view, view)
    orthonormalize4(view)
  }
}
