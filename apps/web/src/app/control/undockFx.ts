/**
 * Кино вылета со станции: «вжуу-вжуу-вжууух».
 *
 * Экран — чёрный тоннель: из центра ширится круглая прорезь на живой космос, сперва
 * медленно, к концу с ускорением. Перед прорезью летят два голубых кольца — каждое
 * своим рывком (первые два «вжуу»). Камера стартует ВПЕРЕДИ корабля и смотрит наружу
 * (корабль позади, не в кадре); за 2 с она откатывается в обычную погоню, и корабль на
 * финальном ускорении обгоняет её и влетает в полный кадр кормой к станции, ровно по
 * оси — кульминационный «вжууух».
 *
 * Как и у прыжка — чистая presentation: физику не трогает, только позу камеры (см.
 * FlightCamera), растровую маску HUD (drawUndock) и наддув газа (playerController).
 * Время крутит директор (render/scene/UndockFx.tsx). Мир при вылете НЕ подменяется,
 * поэтому состояние — простое: активна ли сцена и сколько её идёт.
 */

/** Вся сцена, с. За это время маска раскрывается, кольца уходят, корабль влетает в кадр. */
export const UNDOCK_TOTAL = 2.0

interface UndockFx {
  active: boolean
  /** Прошедшее время сцены, с. */
  t: number
}

const fx: UndockFx = { active: false, t: 0 }

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
  if (fx.t >= UNDOCK_TOTAL) {
    fx.active = false
    fx.t = 0
  }
}

/** Прогресс сцены 0..1. Общая ось времени для маски, колец и обгона камеры. */
export function undockProgress(): number {
  return fx.active ? Math.min(1, fx.t / UNDOCK_TOTAL) : 0
}
