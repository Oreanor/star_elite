import { MANOEUVRE } from '../../config/manoeuvre'
import { clamp } from '../../core/math'
import type { ShipEntity } from '../world/entities'

/**
 * Фигуры пилотажа: бочка, петля, разворот.
 *
 * Живут в домене, а не в контроллере игрока, по той же причине, что и всё
 * остальное: это ПРАВИЛА ПОЛЁТА, а не способ читать клавиатуру. Бот однажды
 * закрутит бочку тем же вызовом, сервер проверит её тем же кодом, а тест
 * проверяет её уже сейчас — без браузера, без мыши и без React.
 *
 * Фигура не двигает корабль: она держит ручку. Уклонение получается ФИЗИКОЙ,
 * а не неуязвимостью — ракета промахивается потому, что корабль сошёл с её линии,
 * а преследователь проскакивает потому, что не смог повторить.
 *
 * Что именно крутим — данные, а не ветвление в контроллере (OCP).
 */
export type ManoeuvreKind = 'barrel' | 'loop' | 'reversal'

export interface Manoeuvre {
  kind: ManoeuvreKind | null
  /** Направление: −1 влево/вниз, +1 вправо/вверх. */
  dir: -1 | 1
  /** Сколько провернули по текущей оси, рад. */
  angle: number
  /** Разворот идёт в два приёма: полупетля, затем докрутка крена. */
  phase: 0 | 1
  elapsed: number
  cooldown: number
}

export function createManoeuvre(): Manoeuvre {
  return { kind: null, dir: 1, angle: 0, phase: 0, elapsed: 0, cooldown: 0 }
}

/** Идёт ли фигура. Спрашивают и контроллер, и камера — правило одно. */
export const manoeuvring = (m: Manoeuvre): boolean => m.kind !== null

/**
 * Держит ли фигура камеру неподвижной.
 *
 * Петля и разворот — фигуры, а не вираж: камера в них не гонится за носом,
 * а спокойно ждёт, пока корабль обойдёт круг. У бочки другое лекарство —
 * ей не передаётся крен, но курс камера подхватывает как обычно.
 */
export const manoeuvreHoldsCamera = (m: Manoeuvre): boolean => m.kind === 'loop' || m.kind === 'reversal'

/** Начать фигуру. Отказывает, пока идёт другая или не остыла предыдущая. */
export function beginManoeuvre(m: Manoeuvre, kind: ManoeuvreKind, dir: -1 | 1): boolean {
  if (m.kind !== null || m.cooldown > 0) return false
  m.kind = kind
  m.dir = dir
  m.angle = 0
  m.phase = 0
  m.elapsed = 0
  return true
}

/** Остудить таймеры. Зовётся каждый шаг, даже когда фигуры нет. */
export function coolManoeuvre(m: Manoeuvre, dt: number): void {
  m.cooldown = Math.max(0, m.cooldown - dt)
}

function endManoeuvre(ship: ShipEntity, m: Manoeuvre): void {
  const c = ship.controls
  m.kind = null
  m.cooldown = MANOEUVRE.COOLDOWN
  c.roll = 0
  c.pitch = 0
  c.strafe = 0
  c.strafeUp = 0
}

/**
 * Бочка: полный оборот вокруг носа, с тягой в НЕПОДВИЖНОМ направлении.
 *
 * Крен идёт вокруг связанной оси Z, поэтому неподвижное в мире направление
 * в связанных осях поворачивается на −θ. Отсюда синус с косинусом: маневровые
 * перекладывают тягу с бортовых на верхние и обратно, удерживая её на месте.
 * Без этого за оборот корабль опишет окружность радиусом a/ω² (метра три)
 * и вернётся на прежнюю линию — красиво и бесполезно.
 */
function driveBarrel(ship: ShipEntity, m: Manoeuvre, dt: number): void {
  const c = ship.controls
  c.roll = m.dir
  // Угол берём из ФАКТИЧЕСКОЙ угловой скорости: раскрутка маневровых не мгновенна.
  m.angle += Math.abs(ship.state.angVel.z) * dt

  const theta = m.angle * m.dir
  c.strafe = Math.cos(theta) * m.dir
  c.strafeUp = -Math.sin(theta) * m.dir

  if (m.angle >= MANOEUVRE.FULL_TURN) endManoeuvre(ship, m)
}

/**
 * Тяга, при которой петля выходит заданного радиуса: v = ω·R.
 *
 * ω берётся ФАКТИЧЕСКАЯ, поэтому в начале фигуры формула просит нулевую тягу.
 * Ниже `LOOP_MIN_THROTTLE` не опускаемся: иначе лётный компьютер гасит ход
 * раньше, чем тангаж успевает раскрутиться, и петля вырождается в кувыркание.
 */
export function loopThrottle(ship: ShipEntity): number {
  const wanted = MANOEUVRE.LOOP_RADIUS * Math.abs(ship.state.angVel.x)
  const share = wanted / Math.max(ship.spec.tuning.MAX_SPEED, 1)
  return clamp(Math.max(share, MANOEUVRE.LOOP_MIN_THROTTLE), 0, 1)
}

/**
 * Петля: полный оборот вокруг тангажа. Корабль уходит вверх (или вниз), обходит
 * круг и ложится на ПРЕЖНИЙ курс, продолжая движение вперёд.
 *
 * Смысл фигуры — пропустить вперёд того, кто сидит на хвосте: он либо
 * проскакивает, либо повторяет петлю и остаётся сзади, потеряв дистанцию.
 * Ракету петля не срывает — от неё уходят бочкой, — но круг уводит корабль
 * с её линии.
 */
function driveLoop(ship: ShipEntity, m: Manoeuvre, dt: number): void {
  ship.controls.pitch = m.dir
  ship.controls.throttle = loopThrottle(ship)
  m.angle += Math.abs(ship.state.angVel.x) * dt
  if (m.angle >= MANOEUVRE.FULL_TURN) endManoeuvre(ship, m)
}

/**
 * Разворот через петлю (иммельман): полупетля, затем полбочки.
 *
 * Полупетля разворачивает корабль на 180°, но вверх ногами — поэтому вторым
 * приёмом идёт докрутка крена. Разворот считается по РАЗНЫМ осям в разных
 * приёмах: тангаж в первом, крен во втором. Общий счётчик угла обнуляется на
 * переходе, иначе быстрый крен «дорисовал» бы недостающий тангаж.
 *
 * Фигура нужна для контратаки: тот, кто был на хвосте, оказывается в прицеле.
 */
function driveReversal(ship: ShipEntity, m: Manoeuvre, dt: number): void {
  const c = ship.controls

  if (m.phase === 0) {
    c.pitch = m.dir
    // Полупетля — та же петля: радиус у неё обязан быть тот же, иначе разворот
    // уносит корабль вперёд ровно туда, откуда он разворачивается уйти.
    c.throttle = loopThrottle(ship)
    m.angle += Math.abs(ship.state.angVel.x) * dt
    if (m.angle >= MANOEUVRE.HALF_TURN) {
      m.phase = 1
      m.angle = 0
      c.pitch = 0
    }
    return
  }

  c.roll = m.dir
  m.angle += Math.abs(ship.state.angVel.z) * dt
  if (m.angle >= MANOEUVRE.HALF_TURN) endManoeuvre(ship, m)
}

/**
 * Ведёт начатую фигуру. Возвращает false, когда штурвал снова у пилота.
 * Зовётся ПОСЛЕ того, как пилот выставил ручку: фигура её перебивает.
 */
export function stepManoeuvre(ship: ShipEntity, m: Manoeuvre, dt: number): boolean {
  if (m.kind === null) return false

  m.elapsed += dt
  // Предохранитель: без маневровых фигура не должна длиться вечно.
  if (m.elapsed >= MANOEUVRE.MAX_DURATION) {
    endManoeuvre(ship, m)
    return false
  }

  if (m.kind === 'barrel') driveBarrel(ship, m, dt)
  else if (m.kind === 'loop') driveLoop(ship, m, dt)
  else driveReversal(ship, m, dt)

  return true
}
