/**
 * АВТОПИЛОТ КОМНАТЫ ТОРА. В пустоте без него не найти ничего: ориентиров нет, а глазом
 * отличить «эта галактика в трёх шагах» от «эта в сорока» стереопроекция не даёт.
 *
 * Цель — ВЕРШИНА решётки (она же галактика, см. `nodeOfVertex`). Tab листает БЛИЖАЙШИЕ
 * галактики от ближней к дальней, последним в круге идёт крест-монумент, потом — выкл.
 * Раньше целей было ровно две (дом и крест), и обе — фиксированные номера вершин: лететь
 * к тому, что видишь перед носом, было нельзя, а после прибытия круг откатывался в начало
 * и следующий Tab выбирал ту же вершину, в которой ты уже стоишь. Автопилот в тот же кадр
 * рапортовал «прибыл» и снимался — со стороны Tab просто не работал через раз.
 *
 * Алгоритм ведения:
 *  1. Слой каждый кадр применяет к цели текущую позу полёта и проецирует её
 *     → мировое НАПРАВЛЕНИЕ на цель (`setTorusNav`).
 *  2. `bushController` доворачивает нос на это направление (`steerToward`).
 *  3. `torusFlight` даёт газ, когда нос совпал с целью; поток S³ тянет узел к центру проекции.
 *  4. Узел пришёл в центр (w→−1) — «прибыл»: газ в ноль, а вершина уходит в `arrivedAt`,
 *     откуда её забирает `stepBush` и выбрасывает игрока из дыры в ту самую галактику.
 *
 * Состояние делят четыре места (контроллер поворота, полёт-газ, слой-рендер, шаг куста) —
 * держим его здесь, в app/control, единой правдой. Ни рендера, ни ввода.
 */

/**
 * ВЫБОР и ВЕДЕНИЕ разделены: прибыв, автопилот отпускает штурвал, но выбор остаётся
 * подсвеченным на HUD — видно, где ты только что был и куда листать дальше.
 */
let target: number | null = null
let engaged = false
/** Место цели в круге Tab. Хранится отдельно: сам список ближайших меняется каждый кадр. */
let rank = -1
/** Вершина, до которой довели. Забирается один раз (`consumeTorusArrival`). */
let arrivedAt: number | null = null

/** Вектор на активную цель (мировые оси) + флаги, обновляет слой каждый кадр. */
const nav = { dx: 0, dy: 0, dz: 0, valid: false, arrived: false }

/** Вершина-цель (она же галактика) или null. HUD помечает её рамкой. */
export function torusTargetVertex(): number | null {
  return target
}

/** Ведёт ли автопилот прямо сейчас. Выбор без ведения — просто метка на HUD. */
export function torusAutopilotActive(): boolean {
  return engaged && target !== null
}

/**
 * Tab: ближайшие галактики по возрастанию дальности → крест-монумент → выкл.
 *
 * `nearest` — вершины, отсортированные по близости (их считает слой; там же и подписи).
 * Список живой, поэтому запоминаем не позицию в нём, а саму вершину: пока летишь, порядок
 * под ногами меняется, но цель обязана стоять.
 */
export function cycleTorusTarget(nearest: readonly number[], monumentVertex: number): void {
  const ring = nearest.includes(monumentVertex) ? nearest : [...nearest, monumentVertex]
  rank = target === null ? 0 : rank + 1
  selectTorusTarget(rank < ring.length ? ring[rank] ?? null : null)
  if (target === null) rank = -1
}

/**
 * Назначить цель, НЕ трогаясь с места. Так же работает карта мира: выбрал галактику — она
 * помечена, но корабль стоит, пока не дашь ход. Выбор и ведение разведены нарочно: в замкнутой
 * S³ дорога к дальней цели проходит СКВОЗЬ чужие узлы, и «выбрал = полетел» означало бы, что
 * тебя выбрасывает у первой попавшейся галактики по пути.
 */
export function selectTorusTarget(vertex: number | null): void {
  target = vertex
  engaged = false
  arrivedAt = null
  nav.valid = false
  nav.arrived = false
}

/** J: вести к выбранной цели / отменить ведение. Без цели — ничего (HUD скажет, что нет цели). */
export function toggleTorusAutopilot(): boolean {
  if (target === null) return false
  engaged = !engaged
  return true
}

/** Прибыли: штурвал мыши, цель остаётся помеченной, вершина — на выдачу `stepBush`. */
export function finishTorusApproach(): void {
  engaged = false
  arrivedAt = target
}

/** Забрать вершину прибытия ровно один раз — выход из комнаты событие, а не состояние. */
export function consumeTorusArrival(): number | null {
  const v = arrivedAt
  arrivedAt = null
  return v
}

export function resetTorusAutopilot(): void {
  target = null
  engaged = false
  rank = -1
  arrivedAt = null
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
