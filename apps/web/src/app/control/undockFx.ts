/**
 * Кино вылета со станции: «вжуу-вжуу-вжууух».
 *
 * Экран — чёрный тоннель: из центра ширится круглая прорезь на живой космос, сперва
 * медленно, к концу с ускорением. Перед прорезью летят пять голубых колец — каждое
 * своим рывком с равным зазором («вжуу-вжуу-…-вжууух»). Камера стартует ВПЕРЕДИ
 * корабля и смотрит наружу (корабль позади, не в кадре); за ~3 с она откатывается в обычную погоню, и корабль на
 * финальном ускорении обгоняет её и влетает в полный кадр кормой к станции, ровно по
 * оси — кульминационный «вжууух».
 *
 * Как и у прыжка — чистая presentation: физику не трогает, только позу камеры (см.
 * FlightCamera), растровую маску HUD (drawUndock) и наддув газа (playerController).
 * Время крутит директор (render/scene/UndockFx.tsx). Мир при вылете НЕ подменяется,
 * поэтому состояние — простое: активна ли сцена и сколько её идёт.
 */

/** Вся сцена, с. За это время маска раскрывается, кольца уходят, корабль влетает в кадр. */
export const UNDOCK_TOTAL = 3.0

/** Пять колец: каждые 0.3 с; пятое = раскрытие маски на космос. */
export const RING_INTERVAL = 0.3
export const RING_COUNT = 5
/** Секунда, когда стартует прорезь (после четырёх импульсных колец). */
export const MASK_START = RING_INTERVAL * (RING_COUNT - 1)

interface UndockFx {
  active: boolean
  /** Прошедшее время сцены, с. */
  t: number
}

const fx: UndockFx = { active: false, t: 0 }

/** Одноразовый флаг: кино вылета кончилось — пора показать «доброго пути». */
let pendingBonVoyage = false

export function undockFx(): UndockFx {
  return fx
}

/** Идёт ли кино вылета. Читают камера, HUD и контроллер игрока. */
export function undocking(): boolean {
  return fx.active
}

/** Запустить сцену — зовётся в момент отчаливания рядом с доменным `undock`. */
export function startUndock(): void {
  fx.active = true
  fx.t = 0
}

/** Крутит время (директор). Большой `dt` (свёрнутая вкладка) зажат — сцена не телепортируется. */
export function advanceUndock(dt: number): void {
  if (!fx.active) return
  fx.t += Math.min(dt, 0.05)
  // «Доброго пути» — когда прорезь и пятое кольцо: над кольцами, не после всего кино.
  if (fx.t >= MASK_START && !pendingBonVoyage) pendingBonVoyage = true
  if (fx.t >= UNDOCK_TOTAL) {
    fx.active = false
    fx.t = 0
  }
}

export function consumePendingBonVoyage(): boolean {
  const v = pendingBonVoyage
  pendingBonVoyage = false
  return v
}

/** Прошедшее время сцены, с (0 пока неактивна). */
export function undockTime(): number {
  return fx.active ? fx.t : 0
}

/** Прогресс сцены 0..1. Общая ось времени для маски, колец и обгона камеры. */
export function undockProgress(): number {
  return fx.active ? Math.min(1, fx.t / UNDOCK_TOTAL) : 0
}
