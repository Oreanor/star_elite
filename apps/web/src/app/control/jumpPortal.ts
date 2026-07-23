import { Matrix4, Plane, Quaternion, Vector3 } from 'three'
import {
  LINKED_PORTAL,
  crossedJumpGate,
  fitsInsideJumpGate,
  jumpGateSide,
  linkedPortalAhead,
  linkedPortalTargetRadius,
  stepLinkedPortalRadius,
  type Arrival,
  type JumpGate,
  type World,
} from '@elite/sim'

/**
 * Портал прыжка по H: неоновое кольцо, две сцены со stencil-маской.
 * Поза игрока связана жёстко с «той» стороной; пересечение диска атомарно меняет систему.
 */

export interface JumpPortal {
  open: boolean
  /** Система у кольца, которое сейчас окружает локального игрока. */
  hereIndex: number
  /** Система за кольцом. После пролёта here/index меняются местами. */
  index: number
  arrival: Arrival | null
  ringPos: Vector3
  ringQuat: Quaternion
  ringNormal: Vector3
  ringRadius: number
  targetRadius: number
  growDir: 1 | -1
  growWasHeld: boolean
  openedAt: number
  /** Точка выхода в целевой системе (без scatter — превью совпадает с «окном»). */
  destPos: Vector3
  destQuat: Quaternion
  destNormal: Vector3
  destReady: boolean
  /**
   * Дальняя сторона построена, смонтирована и прогрета (см. `markPortalDestinationDrawn`).
   * До этого кольца НЕТ вовсе: сборка второго мира и компиляция его шейдеров занимают
   * пару кадров, и раньше они приходились ровно на начало раскрытия — оттого каждое H
   * начиналось рывком. Теперь кольцо рождается уже после них и растёт гладко.
   */
  destWarm: boolean
  prevSide: number | null
  committing: boolean
  /** Клип «этой» стороны (отсекает кусок за плоскостью кольца). */
  clipHere: Plane
  /** Клип «той» стороны. */
  clipThere: Plane
}

let activeWorld: World | null = null
let portalRevision = 0
const portalListeners = new Set<() => void>()
const localGate: JumpGate = {
  pos: new Vector3(),
  normal: new Vector3(0, 0, -1),
  radius: 0,
  tube: LINKED_PORTAL.TUBE,
}

const portal: JumpPortal = {
  open: false,
  hereIndex: 0,
  index: 0,
  arrival: null,
  ringPos: new Vector3(),
  ringQuat: new Quaternion(),
  ringNormal: new Vector3(0, 0, -1),
  ringRadius: 0,
  targetRadius: 0,
  growDir: 1,
  growWasHeld: false,
  openedAt: 0,
  destPos: new Vector3(),
  destQuat: new Quaternion(),
  destNormal: new Vector3(0, 0, -1),
  destReady: false,
  destWarm: false,
  prevSide: null,
  committing: false,
  clipHere: new Plane(),
  clipThere: new Plane(),
}

const _fwd = new Vector3()
const _matA = new Matrix4()
const _matB = new Matrix4()
const _invA = new Matrix4()
const _link = new Matrix4()
const _scale = new Vector3()
const _linkQuat = new Quaternion()
const _invQuat = new Quaternion()

export function jumpPortal(): JumpPortal {
  return portal
}

export function portalOpen(): boolean {
  return portal.open && !portal.committing
}

export function portalActive(): boolean {
  return portal.open || portal.committing
}

/**
 * Настоящий ли это приказ сменить цель портала — или лишний тап по уже открытому кольцу.
 *
 * `openPortal` НЕ очищает `jumpTargetIndex` (в отличие от `enterSystem` при реальном прыжке),
 * поэтому выбранная на карте система остаётся выбранной, пока кольцо растёт. Раньше любой
 * индекс считался новым приказом — и каждое повторное H к ТОЙ ЖЕ цели закрывало пару,
 * `disposeJumpPortalWorld` сносил готовый дальний мир, а `openPortal` строил его с нуля.
 * React не успевал заново смонтировать сцену за кольцом — второе-третье кольцо смотрело
 * «на просвет», пока пара кадров не достроит мир («полетал вокруг — починилось»).
 *
 * Пока портал РАСКРЫТ к этой самой цели, повторное H — рост того же кольца, не приказ.
 * Пройденный портал закрывается сам, поэтому выбор дальней системы после прохода —
 * обычное новое открытие.
 */
export function portalRetargetRequested(target: number | null): target is number {
  if (target === null) return false
  if (portal.open && target === portal.index) return false
  return true
}

/** Удержание растит портал через isHeld; автоповтор keydown не является новой командой. */
export function freshPortalKeyDown(repeated: boolean): boolean {
  return !repeated
}

/** React слушает только редкие открытия/смены мира, не покадровое состояние портала. */
export function jumpPortalRevision(): number {
  return portalRevision
}

export function subscribeJumpPortal(listener: () => void): () => void {
  portalListeners.add(listener)
  return () => portalListeners.delete(listener)
}

function notifyPortalChanged(): void {
  portalRevision += 1
  for (const listener of portalListeners) listener()
}

/** Обновить клип-плоскости по текущей позе кольца. */
function syncClipPlanes(): void {
  // three.js отбрасывает ОТРИЦАТЕЛЬНУЮ полусферу Plane. В исходном мире оставляем
  // подходную сторону, а в целевом — уже прошедшую. У каждой стороны свои координаты.
  portal.clipHere.setFromNormalAndCoplanarPoint(
    _fwd.copy(portal.ringNormal).negate(),
    portal.ringPos,
  )
  portal.clipThere.setFromNormalAndCoplanarPoint(
    portal.destNormal,
    portal.destPos,
  )
}

function syncGate(world: World): void {
  if (!world.jumpGates.includes(localGate)) world.jumpGates.push(localGate)
  localGate.pos.copy(portal.ringPos)
  localGate.normal.copy(portal.ringNormal)
  syncGateShape()
}

/**
 * Во время роста позой владеет уже сдвинутый симуляцией collider; меняется только форма.
 *
 * Пока кольцо не родилось, обода физически НЕТ: труба нулевая, задевать нечего. Иначе на
 * месте ещё не открывшегося устья висел бы невидимый бампер. Коллайдер при этом остаётся
 * в мире — он же переносит позу устья через сдвиги плавающего начала отсчёта.
 */
function syncGateShape(): void {
  localGate.radius = portal.ringRadius
  localGate.tube = portal.destWarm ? LINKED_PORTAL.TUBE : 0
}

export function openPortal(world: World, index: number, arrival: Arrival | null, realTime: number): void {
  activeWorld = world
  const s = world.player.state
  _fwd.set(0, 0, -1).applyQuaternion(s.quat)
  portal.ringPos.copy(s.pos).addScaledVector(_fwd, linkedPortalAhead(world.player))
  portal.ringQuat.copy(s.quat)
  portal.ringNormal.copy(_fwd)
  // Чистый диаметр в пределе задаётся числом диаметров открывшего портал корпуса.
  portal.targetRadius = linkedPortalTargetRadius(world.player)
  portal.ringRadius = 0
  portal.growDir = 1
  portal.growWasHeld = true
  portal.openedAt = realTime
  portal.hereIndex = world.systemIndex
  portal.index = index
  portal.arrival = arrival
  portal.prevSide = null
  portal.committing = false
  portal.destReady = false
  portal.destWarm = false
  portal.open = true
  syncClipPlanes()
  syncGate(world)
  notifyPortalChanged()
}

/** Поза «того» кольца в целевой системе (зовёт превью-мир при сборке). */
/**
 * Дальняя сторона готова к показу — с этого момента кольцо и рождается. Зовёт
 * stencil-проход, а не React: только он знает, что сцена не пуста и её шейдеры уже
 * скомпилированы. Пара кадров задержки взамен рывка на первом же кадре раскрытия.
 */
export function markPortalDestinationDrawn(): void {
  portal.destWarm = true
}

export function setDestPortal(pos: Vector3, quat: Quaternion): void {
  portal.destPos.copy(pos)
  portal.destQuat.copy(quat)
  portal.destNormal.set(0, 0, -1).applyQuaternion(quat)
  portal.destReady = true
  syncClipPlanes()
}

export function closePortal(): void {
  if (activeWorld) {
    const i = activeWorld.jumpGates.indexOf(localGate)
    if (i >= 0) activeWorld.jumpGates.splice(i, 1)
  }
  activeWorld = null
  portal.open = false
  portal.committing = false
  portal.prevSide = null
  portal.destReady = false
  portal.destWarm = false
  notifyPortalChanged()
}

export function beginPortalCommit(): void {
  portal.committing = true
  portal.open = false
}

/**
 * Связать камеру/корабль: outWorld = destPortal * inv(herePortal) * inWorld.
 * Пишет position+quaternion в outPos/outQuat.
 */
export function linkThroughPortal(
  inPos: Vector3,
  inQuat: Quaternion,
  outPos: Vector3,
  outQuat: Quaternion,
): void {
  _matA.compose(portal.ringPos, portal.ringQuat, _scale.set(1, 1, 1))
  _matB.compose(portal.destPos, portal.destQuat, _scale.set(1, 1, 1))
  _invA.copy(_matA).invert()
  _link.multiplyMatrices(_matB, _invA)
  _matA.compose(inPos, inQuat, _scale.set(1, 1, 1))
  _matA.premultiply(_link)
  _matA.decompose(outPos, outQuat, _scale)
}

/**
 * Успешный пролёт. Тоннель на этом кончается: кольца за спиной не остаётся, обратный
 * прыжок — это новое открытие портала.
 *
 * Логический портал закрываем СРАЗУ, не дожидаясь React: прогретая destination Scene
 * доживает до handoff отдельно, а блокирующий управление `committing` при пропущенном
 * или задержавшемся layout-эффекте оставлял следующий H немым.
 */
export function completePortalTransit(world: World): void {
  // Коллайдер устья остался в ПОКИНУТОМ мире — снимаем его оттуда, а не из нового.
  if (activeWorld && activeWorld !== world) {
    const gateIndex = activeWorld.jumpGates.indexOf(localGate)
    if (gateIndex >= 0) activeWorld.jumpGates.splice(gateIndex, 1)
  }
  activeWorld = null
  portal.open = false
  portal.committing = false
  portal.prevSide = null
  portal.destReady = false
  portal.destWarm = false
}

/** Неудачный переход не уничтожает уже открытый тоннель. */
export function cancelPortalCommit(): void {
  portal.prevSide = null
  portal.committing = false
  portal.open = true
}

/** Повернуть мировой вектор (например скорость) из кадра входа в кадр выхода. */
export function linkVectorThroughPortal(input: Vector3, out: Vector3): void {
  _invQuat.copy(portal.ringQuat).invert()
  _linkQuat.multiplyQuaternions(portal.destQuat, _invQuat)
  out.copy(input).applyQuaternion(_linkQuat)
}

export function tickPortal(world: World, dt: number, growHeld: boolean, realTime: number): 'cross' | 'close' | null {
  if (!portal.open || portal.committing) return null

  if (realTime - portal.openedAt >= LINKED_PORTAL.LIFE_SECONDS) {
    closePortal()
    return 'close'
  }

  // Сначала читаем позу collider после шага симуляции. Раньше рост ниже вызывал полный
  // syncGate и записывал сюда старую ringPos прошлого кадра: кольцо летало лишь пока
  // менялся радиус, а после отпускания H внезапно стабилизировалось.
  if (world.jumpGates.includes(localGate)) {
    portal.ringPos.copy(localGate.pos)
    portal.ringNormal.copy(localGate.normal)
    syncClipPlanes()
  }

  // Отпускание только фиксирует достигнутый размер. Направление меняется на НОВОМ
  // нажатии: так keyup не может ни схлопнуть портал, ни дать кадр обратного движения.
  // Первое нажатие уже записано openPortal через growWasHeld=true, поэтому оно раскрывает.
  if (!portal.growWasHeld && growHeld) portal.growDir = portal.growDir === 1 ? -1 : 1
  portal.growWasHeld = growHeld
  // Кольцо не рождается, пока не готова дальняя сторона: её сборка занимает пару кадров,
  // и раньше они выпадали ровно на начало раскрытия. Удержание H в это время не копится —
  // раскрытие честно начинается с нуля с того кадра, когда за кольцом уже есть мир.
  if (growHeld && portal.destWarm) {
    portal.ringRadius = stepLinkedPortalRadius(
      portal.ringRadius,
      portal.targetRadius,
      portal.growDir,
      true,
      dt,
    )
    syncGateShape()
    if (portal.ringRadius <= 0 && portal.growDir < 0) {
      closePortal()
      return 'close'
    }
  }

  // Коррекция масштаба несовместима уже с СУЩЕСТВУЮЩИМ тоннелем, а не только
  // с его открытием: как только корабль покидает 1×, оба устья схлопываются.
  if (world.player.state.scale !== 1) {
    closePortal()
    return 'close'
  }

  if (world.systemIndex !== portal.hereIndex) {
    closePortal()
    return 'close'
  }

  const side = jumpGateSide(world.player, localGate)
  // Сторону отслеживаем и во время удержания H. Иначе корабль с уже набранной скоростью
  // успевал пройти плоскость за время раскрытия, а после отпускания оказывался по ту
  // сторону без события. Неподвижный пилот по-прежнему может стоять и рассматривать окно.
  // Пока кольца нет, перехода не бывает ни при каких позах: второй системы ещё не
  // существует, и «пролёт» через нулевое устье уводил бы в несобранный мир.
  if (portal.destWarm && crossedJumpGate(portal.prevSide, side, fitsInsideJumpGate(world.player, localGate))) {
    beginPortalCommit()
    return 'cross'
  }
  portal.prevSide = side
  return null
}
