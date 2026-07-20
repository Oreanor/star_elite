import { UNIVERSE, edgeLength, neighborsOf, type Universe } from './universe'

/**
 * Движение по кусту — РЕЛЬСЫ, а не полёт.
 *
 * Корабль не летает между галактиками свободно: он едет по ребру, как вагонетка. Газ
 * двигает его вдоль ребра, в узле выбирается следующая ветка. Манёвры отключены —
 * рулить в пустоте между галактиками не по чему, а свободный полёт превратил бы куст
 * в обычное трёхмерное поле и убил бы всю его геометрию.
 *
 * Здесь только СОСТОЯНИЕ и правила перехода. Ни рендера, ни ввода, ни времени: шаг
 * получает `dt` и «сколько дан газ» — кто их дал, домену безразлично (тот же шов, что
 * у автопилота).
 */

export interface BushTravel {
  /** Едем ли мы по кусту вообще. Ложь — игрок в обычном космосе. */
  active: boolean
  /** Узел, в котором стоим или из которого выехали. */
  node: number
  /** Куда едем. −1 — стоим в узле и выбираем ветку. */
  edgeTo: number
  /** Доля пройденного ребра, 0..1. Осмысленна только когда `edgeTo >= 0`. */
  t: number
  /**
   * Мы В КОМНАТЕ МОНУМЕНТА — особом пустом пространстве с крестом, а не на карте куста.
   * Вход и выход по БЛИЗОСТИ к кресту: достиг — вошёл, отдалился — вышел (см.
   * `monumentRoomEntered` / `monumentRoomExited`). Ровно тот же приём, что у Двери-дыры.
   */
  inMonument: boolean
}

/**
 * Дистанция от креста (м), дальше которой комната монумента закрывается и игрок
 * возвращается на карту куста. Вход — по касанию креста (радиус тела), выход — по этому
 * порогу: между ними зазор, иначе на самой границе комната мигала бы вход-выход.
 */
export const MONUMENT_ROOM_EXIT_M = 10_000

/** Достиг креста — комната открывается. Крест «как станция»: порог — его радиус. */
export function monumentRoomEntered(distanceToCross: number, crossRadius: number): boolean {
  return distanceToCross <= crossRadius
}

/** Отдалился от креста за порог — комната закрывается, выходим на карту. */
export function monumentRoomExited(distanceToCross: number): boolean {
  return distanceToCross > MONUMENT_ROOM_EXIT_M
}

/**
 * Скорость хода по ребру: долей ребра в секунду при полном газе.
 *
 * Задана В ДОЛЯХ, а не в гиперболических единицах: рёбра разной длины должны
 * проезжаться за одно и то же время, иначе короткие проскакивают мгновенно, а длинные
 * тянутся, и ритм путешествия скачет без всякой причины.
 */
export const BUSH_SPEED = 0.45

export function createBushTravel(): BushTravel {
  return { active: false, node: UNIVERSE.MONUMENT_NODE, edgeTo: -1, t: 0, inMonument: false }
}

/** Войти на куст в указанном узле. Повторный вход ничего не ломает. */
export function enterBush(travel: BushTravel, node: number): void {
  travel.active = true
  travel.node = node
  travel.edgeTo = -1
  travel.t = 0
  travel.inMonument = false
}

export function leaveBush(travel: BushTravel): void {
  travel.active = false
  travel.edgeTo = -1
  travel.t = 0
  travel.inMonument = false
}

/** Стоим ли в узле (а не посреди ребра). Только тут можно выбирать ветку. */
export function atNode(travel: BushTravel): boolean {
  return travel.active && travel.edgeTo < 0
}

/**
 * Тронуться к соседу. Возвращает false, если это не сосед или мы уже едем.
 *
 * Проверка соседства не формальность: рельсы обязаны быть рельсами. Разреши прыжок
 * к произвольному узлу — и куст перестанет быть кустом, а станет списком галактик.
 */
export function departTo(travel: BushTravel, universe: Universe, to: number): boolean {
  if (!atNode(travel)) return false
  if (!neighborsOf(universe, travel.node).includes(to)) return false
  travel.edgeTo = to
  travel.t = 0
  return true
}

/**
 * Шаг движения. `throttle` — 0..1.
 *
 * Приехав, корабль ВСТАЁТ в узле, а не проскакивает его насквозь: узел — это выбор,
 * и проскочить его значило бы отнять выбор. Остаток хода за этот кадр отбрасывается
 * намеренно — иначе на большом `dt` корабль пролетал бы по нескольку узлов подряд
 * в случайную сторону.
 *
 * @returns индекс узла, в который только что прибыли, или −1.
 */
export function stepBushTravel(
  travel: BushTravel,
  universe: Universe,
  throttle: number,
  dt: number,
): number {
  if (!travel.active || travel.edgeTo < 0) return -1
  if (throttle <= 0 || dt <= 0) return -1

  const len = edgeLength(universe, travel.node, travel.edgeTo)
  // Ребро нулевой длины сделало бы шаг бесконечным: доезжаем сразу.
  const step = len > 1e-9 ? (BUSH_SPEED * throttle * dt) : 1
  travel.t += step

  if (travel.t < 1) return -1

  const arrived = travel.edgeTo
  travel.node = arrived
  travel.edgeTo = -1
  travel.t = 0
  return arrived
}
