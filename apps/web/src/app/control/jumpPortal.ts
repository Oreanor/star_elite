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
  /** Первый проход уже списал заряд; дальше тоннель существует сам. */
  paid: boolean
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
  paid: false,
  prevSide: null,
  committing: false,
  clipHere: new Plane(),
  clipThere: new Plane(),
}

const _fwd = new Vector3()
const _rel = new Vector3()
const _matA = new Matrix4()
const _matB = new Matrix4()
const _invA = new Matrix4()
const _link = new Matrix4()
const _scale = new Vector3()
const _linkQuat = new Quaternion()
const _invQuat = new Quaternion()
const _flip = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)

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
 * Различаем по паре (index, paid): пока портал раскрыт К ЭТОЙ цели и ещё НЕ пройден
 * (`!paid`), повторное H — не смена цели, а рост того же кольца. После прохода роли устьев
 * меняются, `paid` становится истинным, и выбор дальней системы — уже честный обратный прыжок.
 */
export function portalRetargetRequested(target: number | null): target is number {
  if (target === null) return false
  if (portal.open && !portal.paid && target === portal.index) return false
  return true
}

/** После прохода H без новой цели закрывает невидимую за спиной оплаченную пару. */
export function establishedPortalCloseRequested(target: number | null, paid: boolean): boolean {
  return paid && target === null
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
  localGate.radius = portal.ringRadius
  localGate.tube = LINKED_PORTAL.TUBE
}

/** Во время роста позой владеет уже сдвинутый симуляцией collider; меняется только форма. */
function syncGateShape(): void {
  localGate.radius = portal.ringRadius
  localGate.tube = LINKED_PORTAL.TUBE
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
  portal.paid = false
  portal.open = true
  syncClipPlanes()
  syncGate(world)
  notifyPortalChanged()
}

/** Поза «того» кольца в целевой системе (зовёт превью-мир при сборке). */
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
  portal.paid = false
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

/** После успешного пролёта локальная и дальняя стороны меняются ролями, но не исчезают. */
export function completePortalTransit(
  world: World,
  sourceOriginOffset: Vector3,
  keepOpen = true,
): void {
  if (activeWorld && activeWorld !== world) {
    const gateIndex = activeWorld.jumpGates.indexOf(localGate)
    if (gateIndex >= 0) activeWorld.jumpGates.splice(gateIndex, 1)
  }
  activeWorld = world

  const hereIndex = portal.hereIndex
  portal.hereIndex = portal.index
  portal.index = hereIndex

  // Ближнее устье локально, дальнее абсолютно. Старое переводим в абсолютный
  // кадр, новое — в плавающее начало отсчёта только что построенной системы.
  _rel.copy(portal.ringPos).add(sourceOriginOffset)
  portal.ringPos.copy(portal.destPos).sub(world.originOffset)
  portal.destPos.copy(_rel)

  _invQuat.copy(portal.ringQuat)
  portal.ringQuat.copy(portal.destQuat).multiply(_flip)
  portal.destQuat.copy(_invQuat).multiply(_flip)

  portal.ringNormal.set(0, 0, -1).applyQuaternion(portal.ringQuat)
  portal.destNormal.set(0, 0, -1).applyQuaternion(portal.destQuat)
  portal.arrival = null
  portal.prevSide = null
  // Успешный переход завершает ЛОГИЧЕСКИЙ портал сразу. Прогретая destination Scene
  // доживает до React-handoff отдельно, без блокирующего управление `committing`.
  // Иначе пропущенный/задержавшийся layout effect оставлял следующий H немым.
  portal.committing = false
  portal.open = keepOpen
  portal.paid = true
  syncClipPlanes()
  if (keepOpen) {
    syncGate(world)
    notifyPortalChanged()
  }
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
  if (growHeld) {
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
  if (crossedJumpGate(portal.prevSide, side, fitsInsideJumpGate(world.player, localGate))) {
    beginPortalCommit()
    return 'cross'
  }
  portal.prevSide = side
  return null
}
