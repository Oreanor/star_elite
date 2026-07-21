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

/** Сбросить вид в единицу — узел под игроком (вход в комнату / новая сессия). */
export function resetTorusFlight(): void {
  identity4(view)
  throttle = 0
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
  // Газ — обычный СЕКТОР: W наращивает, S убавляет, отпустил — держится. Тот же темп, что у пилота.
  if (isHeld('KeyW')) throttle += TORUS.THROTTLE_RATE * dt
  if (isHeld('KeyS')) throttle -= TORUS.THROTTLE_RATE * dt
  throttle = throttle < 0 ? 0 : throttle > 1 ? 1 : throttle
  if (throttle > 1e-4) {
    _fwd.copy(_zBack).applyQuaternion(shipQuat)
    // Знак проверен численно (signcheck): при +angle галактика ПО НОСУ приближается — летим В неё.
    const angle = throttle * TORUS.FLY_RATE * dt
    rotPlaneW(_fwd.x, _fwd.y, _fwd.z, angle, _step)
    mul4(_step, view, view)
    orthonormalize4(view)
  }
}
