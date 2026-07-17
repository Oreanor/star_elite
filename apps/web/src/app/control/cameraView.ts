import { clamp } from '@elite/sim'
import { consumePress, isHeld } from '../../platform/input/input'

/**
 * Пользовательский ракурс камеры поверх обычной погони.
 *
 *   ← / →  — облёт вокруг ЦЕНТРА корабля (азимут вокруг его вертикали);
 *   ↑ / ↓  — наезд / отъезд (ближе — вплоть до пары метров, дальше — на пару сотен %);
 *   V      — сброс к погонному виду по умолчанию.
 *
 * Чистая presentation: копится здесь, читает FlightCamera. Выставил ракурс — и летишь
 * с ним, пока не сбросишь. Азимут и множитель дистанции живут между кадрами.
 */

/** Скорость облёта, рад/с. */
const ORBIT_RATE = 1.6
/** Скорость наезда — экспонента, как рост у миелофона: держишь ровно, идёт плавно. 1/с. */
const ZOOM_RATE = 1.3
/**
 * Множитель чейз-дистанции. 1 — умолчание (~24 м). Вниз до ~0.06 — это 1–2 м «в упор»,
 * вверх до 3 — «пара сотен процентов» отхода. Зажат с обоих концов, чтобы не улететь.
 */
const ZOOM_MIN = 0.06
const ZOOM_MAX = 3

const view = { azimuth: 0, distance: 1 }

/**
 * Сброс запрошен, но ещё не отработан камерой. Азимут с дистанцией живут ЗДЕСЬ и гасятся
 * сразу, а вот накопленный курс с КРЕНОМ живёт в самой камере (`camSwing`/`camTwist`) — она
 * их и чистит, забрав этот флаг. Иначе после облёта крен оставался несвежим, и корабль
 * оказывался чуть накренён даже после V.
 */
let resetPending = false

export function cameraView(): { readonly azimuth: number; readonly distance: number } {
  return view
}

/** Сброс к погонному виду по умолчанию (клавиша V): ракурс здесь, состояние камеры — флагом. */
export function resetCameraView(): void {
  view.azimuth = 0
  view.distance = 1
  resetPending = true
}

/** Забрать запрос сброса (одноразовый). Зовёт FlightCamera, чтобы снять накопленный крен/курс. */
export function consumeViewReset(): boolean {
  const pending = resetPending
  resetPending = false
  return pending
}

/**
 * Шаг ракурса: читает стрелки и V, копит азимут и дистанцию. Зовётся раз в кадр из
 * входного хаба (Simulation) — ДО `clearPresses`, иначе тап V не долетит.
 */
export function stepCameraView(dt: number): void {
  if (consumePress('KeyV')) resetCameraView()

  // Знак согласован с turntable-облётом (взгляд = lookAt): «влево» уводит камеру ВЛЕВО.
  if (isHeld('ArrowLeft')) view.azimuth -= ORBIT_RATE * dt
  if (isHeld('ArrowRight')) view.azimuth += ORBIT_RATE * dt

  // ↑ ближе, ↓ дальше. Множим, а не прибавляем: у зума естественный шаг — доля, а не метр.
  if (isHeld('ArrowUp')) view.distance = clamp(view.distance * Math.exp(-ZOOM_RATE * dt), ZOOM_MIN, ZOOM_MAX)
  if (isHeld('ArrowDown')) view.distance = clamp(view.distance * Math.exp(ZOOM_RATE * dt), ZOOM_MIN, ZOOM_MAX)
}
