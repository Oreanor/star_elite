/**
 * АВТОПИЛОТ КОМНАТЫ ТОРА. В пустоте без него не найти ни дом, ни крест — ориентиров мало.
 * Автопилот ведёт к одному из ДВУХ узлов: домашняя галактика или крест-монумент; Tab переключает.
 *
 * Алгоритм (см. также объяснение в диалоге):
 *  1. Слой каждый кадр берёт активную цель-узел, применяет к ней текущую позу полёта и проецирует
 *     → мировое НАПРАВЛЕНИЕ на цель (`setTorusNav`).
 *  2. `bushController` доворачивает нос на это направление (`steerToward`).
 *  3. `torusFlight` даёт газ, когда нос совпал с целью; поток S³ тянет узел к центру проекции.
 *  4. Узел пришёл в центр (w→−1) — «прибыл»: газ в ноль, автопилот снимается, штурвал у мыши.
 *
 * Состояние делят три места (контроллер поворота, полёт-газ, слой-рендер) — держим его здесь,
 * в app/control, единой правдой. Ни рендера, ни ввода: только цель и посчитанный слоем вектор.
 */

export type TorusTarget = 'home' | 'cross'

let target: TorusTarget | null = null

/** Вектор на активную цель (мировые оси) + флаги, обновляет слой каждый кадр. */
const nav = { dx: 0, dy: 0, dz: 0, valid: false, arrived: false }

export function torusAutopilotTarget(): TorusTarget | null {
  return target
}

export function torusAutopilotActive(): boolean {
  return target !== null
}

/** Tab: выкл → дом → крест → выкл. */
export function cycleTorusAutopilot(): void {
  target = target === null ? 'home' : target === 'home' ? 'cross' : null
  nav.valid = false
  nav.arrived = false
}

export function setTorusAutopilotTarget(t: TorusTarget | null): void {
  target = t
}

export function resetTorusAutopilot(): void {
  target = null
  nav.valid = false
  nav.arrived = false
}

/** Слой сообщает направление на цель (нормированное, мировые оси) и достигнута ли она. */
export function setTorusNav(
  dx: number,
  dy: number,
  dz: number,
  valid: boolean,
  arrived: boolean,
): void {
  nav.dx = dx
  nav.dy = dy
  nav.dz = dz
  nav.valid = valid
  nav.arrived = arrived
}

export function torusNav(): Readonly<typeof nav> {
  return nav
}
