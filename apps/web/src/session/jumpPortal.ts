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
import { hlog, hstate } from './hyperLog'

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
  /**
   * H удерживают ПРЯМО СЕЙЧАС. Кольцо только раскрывается — обратного хода у него нет:
   * повторное нажатие схлопывает пару мгновенно и ставит новую перед носом, а плавное
   * сжатие лишь путало (жмёшь H, ожидая новое кольцо, а старое медленно уезжает в ноль).
   * Флаг нужен HUD: пока держат — голубая плашка «открытие гиперкольца».
   */
  growHeld: boolean
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
  growHeld: false,
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
  portal.growHeld = true
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
  const v = (p: Vector3) => `${p.x.toFixed(0)} ${p.y.toFixed(0)} ${p.z.toFixed(0)}`
  hlog('ГДЕ открыли', {
    systemIndex: world.systemIndex,
    цель: index,
    игрок: v(s.pos),
    скорость: s.vel.length().toFixed(1),
    носВперёд: v(_fwd),
    впереди_м: linkedPortalAhead(world.player).toFixed(0),
    кольцо: v(portal.ringPos),
    предельныйРадиус: portal.targetRadius.toFixed(1),
    originOffset: v(world.originOffset),
    гейтовВМире: world.jumpGates.length,
  })
  notifyPortalChanged()
}

/** Поза «того» кольца в целевой системе (зовёт превью-мир при сборке). */
/**
 * Дальняя сторона готова к показу — с этого момента кольцо и рождается. Зовёт
 * stencil-проход, а не React: только он знает, что сцена не пуста и её шейдеры уже
 * скомпилированы. Пара кадров задержки взамен рывка на первом же кадре раскрытия.
 */
export function markPortalDestinationDrawn(): void {
  if (!portal.destWarm) hlog('дальняя сторона ПРОГРЕТА — кольцу разрешено расти')
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
  if (!portal.open || portal.committing) {
    hstate('такт', portal.committing ? 'переход, такта нет' : 'портала нет')
    return null
  }

  if (realTime - portal.openedAt >= LINKED_PORTAL.LIFE_SECONDS) {
    hlog('ЗАКРЫТ: истекла минута жизни пары')
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

  // Отпускание только фиксирует достигнутый размер: кольцо не умеет уменьшаться. Раньше
  // повторное удержание разворачивало рост в сжатие — и пилот, ждавший НОВОЕ кольцо перед
  // носом, вместо этого смотрел, как медленно уезжает в ноль старое. Теперь повторное
  // нажатие схлопывает пару мгновенно и ставит новую (см. обработчик H).
  portal.growHeld = growHeld

  hstate(
    'состояние кольца',
    `${portal.destWarm ? 'дальняя сторона готова' : 'ЖДЁМ дальнюю сторону'}, H ${growHeld ? 'держат' : 'отпущена'}`,
    { ringRadius: portal.ringRadius, targetRadius: portal.targetRadius, destReady: portal.destReady },
  )

  /*
   * Кольцо растёт с ПЕРВОГО кадра удержания. Гейтить сам рост готовностью дальней стороны
   * нельзя: она приходит через два-четыре кадра, и всё это время нажатие пропадало впустую.
   * Тап по H оставлял портал открытым, но нулевым, а дальше клавиша молчала — та же цель у
   * открытого кольца приказом не считается. Ровно это и выглядело как «то работает, то нет».
   *
   * Готовность гейтит только ПОКАЗ и ТВЁРДОСТЬ (`syncGateShape` и stencil-проход): первые
   * кадры кольцо есть, но его не видно и сквозь него не пройти. Раскрытие идёт 2.5 с, так
   * что показывается оно на паре процентов радиуса — глазу это ноль, а тяжёлая сборка
   * успевает пройти под невидимым кольцом.
   */
  if (growHeld) {
    portal.ringRadius = stepLinkedPortalRadius(portal.ringRadius, portal.targetRadius, 1, true, dt)
    syncGateShape()
  }

  // Коррекция масштаба несовместима уже с СУЩЕСТВУЮЩИМ тоннелем, а не только
  // с его открытием: как только корабль покидает 1×, оба устья схлопываются.
  if (world.player.state.scale !== 1) {
    hlog('ЗАКРЫТ: масштаб не единичный', { scale: world.player.state.scale })
    closePortal()
    return 'close'
  }

  if (world.systemIndex !== portal.hereIndex) {
    hlog('ЗАКРЫТ: система сменилась под порталом', {
      systemIndex: world.systemIndex,
      hereIndex: portal.hereIndex,
    })
    closePortal()
    return 'close'
  }

  const side = jumpGateSide(world.player, localGate)
  // Сторону отслеживаем и во время удержания H. Иначе корабль с уже набранной скоростью
  // успевал пройти плоскость за время раскрытия, а после отпускания оказывался по ту
  // сторону без события. Неподвижный пилот по-прежнему может стоять и рассматривать окно.
  // Пока кольца нет, перехода не бывает ни при каких позах: второй системы ещё не
  // существует, и «пролёт» через нулевое устье уводил бы в несобранный мир.
  const fits = fitsInsideJumpGate(world.player, localGate)
  // Пилот у самой плоскости — самый интересный кадр: либо он сейчас пройдёт, либо
  // отскочит от трубы. Пишем, ЧТО именно мешает: маленькое кольцо или мимо отверстия.
  if (Math.abs(side) < localGate.radius + LINKED_PORTAL.TUBE) {
    hstate('у плоскости кольца', fits ? 'корпус в отверстие проходит' : 'корпус в отверстие НЕ проходит', {
      side,
      ringRadius: localGate.radius,
      tube: localGate.tube,
      shipRadius: world.player.spec.hull.radius * world.player.state.scale,
      destWarm: portal.destWarm,
    })
  }
  if (portal.destWarm && crossedJumpGate(portal.prevSide, side, fits)) {
    hlog('ПЕРЕСЕЧЕНИЕ плоскости — переход', { prevSide: portal.prevSide, side })
    beginPortalCommit()
    return 'cross'
  }
  portal.prevSide = side
  return null
}
