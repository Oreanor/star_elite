import { PerspectiveCamera, Quaternion, Scene, Vector3, type Camera } from 'three'
import {
  CORE_INDEX,
  aiController,
  applyPlayerSave,
  arrivalPointAt,
  createWorld,
  driftContacts,
  enterSystem,
  isCore,
  serializePlayer,
  spawnResidentContacts,
  stepWorld,
  systemDefFor,
  type Controller,
  type World,
} from '@elite/sim'
import type { Session } from '../../app/GameContext'
import { jumpPortal, linkThroughPortal, linkVectorThroughPortal, setDestPortal } from '../../app/control/jumpPortal'

/** Полноценный второй World и его отдельная three-сцена. */
export interface PreparedJumpWorld {
  key: string
  scene: Scene
  camera: PerspectiveCamera
  world: World
  session: Session
}

let prepared: PreparedJumpWorld | null = null
let promoted: PreparedJumpWorld | null = null
const emptyScene = new Scene()
const emptyCamera = new PerspectiveCamera(70, 1, 0.5, 2e12)

const _look = new Vector3()
const _from = new Vector3()
const _zNeg = new Vector3(0, 0, -1)
const _destQuat = new Quaternion()
const _camPos = new Vector3()
const _camQuat = new Quaternion()
const _camScale = new Vector3()
const _playerPos = new Vector3()
const _playerQuat = new Quaternion()
const _playerVel = new Vector3()

function syncPreparedControllers(target: PreparedJumpWorld): void {
  const { controllers, world } = target.session
  if (
    controllers.size === world.ships.length
    && world.ships.every((ship) => controllers.has(ship.id))
  ) return
  controllers.clear()
  for (const ship of world.ships) controllers.set(ship.id, aiController as Controller)
}

/**
 * Система строится тем же доменом, что и после настоящего прыжка. Никаких ручных
 * сфер-звёзд и приблизительных материалов: React ниже смонтирует в `scene` общий
 * `WorldVisuals`, которым пользуется основная игра.
 */
export function prepareJumpPortalWorld(source: Session): PreparedJumpWorld {
  const p = jumpPortal()
  const key = `${source.world.galaxySeed}:${p.index}:${p.arrival ? JSON.stringify(p.arrival) : 'n'}`
  if (prepared?.key === key) return prepared

  const sourceWorld = source.world
  const destIndex = isCore(p.index) ? CORE_INDEX : p.index
  const seat = p.arrival?.kind === 'body' ? p.arrival.planet : undefined
  const def = systemDefFor(destIndex, sourceWorld.galaxySeed, seat)
  const start = arrivalPointAt(def, p.arrival, sourceWorld.calendarTime)

  _from.set(start[0], start[1], start[2])
  const layoutWorld = createWorld()
  layoutWorld.galaxySeed = sourceWorld.galaxySeed
  layoutWorld.calendarTime = sourceWorld.calendarTime
  enterSystem(layoutWorld, def, destIndex, start)
  layoutWorld.time = sourceWorld.time
  applyPlayerSave(layoutWorld, {
    ...serializePlayer(sourceWorld),
    galaxySeed: sourceWorld.galaxySeed,
    systemIndex: destIndex,
  })
  // Это не декорация за маской, а тот самый World, который затем будет принят без
  // перестройки. Поэтому постоянные жители обязаны появиться до первого видимого кадра.
  driftContacts(layoutWorld)
  spawnResidentContacts(layoutWorld)

  const lookAt = layoutWorld.bodies.find((body) => body.kind === 'station')
    ?? layoutWorld.bodies.find((body) => body.kind === 'planet')
    ?? layoutWorld.bodies.find((body) => body.kind === 'star')
  if (lookAt) {
    _look.copy(lookAt.pos).add(layoutWorld.originOffset).sub(_from)
    if (_look.lengthSq() < 1) _look.copy(_zNeg)
    else _look.normalize()
  } else {
    _look.copy(_zNeg)
  }
  _destQuat.setFromUnitVectors(_zNeg, _look)
  if (!p.destReady) {
    // Дальнее устье хранится в абсолютных координатах системы; сам World уже
    // перецентрован `enterSystem`, чтобы GPU не получал координаты порядка 1e11.
    setDestPortal(_from, _destQuat)
  }

  const camera = new PerspectiveCamera(70, 1, 0.5, 2e12)
  camera.matrixAutoUpdate = false
  const session: Session = {
    ...source,
    world: layoutWorld,
    controllers: new Map(),
    running: false,
    menuFlying: false,
    onOver: null,
    onDockChange: null,
    onSystemChange: null,
  }
  prepared = { key, scene: new Scene(), camera, world: layoutWorld, session }
  return prepared
}

/** Игрок существует во втором World номинально: поза связана с настоящей через пару устьев. */
function syncPreparedPlayer(source: Session, target: PreparedJumpWorld): void {
  const src = source.world.player
  const dstWorld = target.world
  const dst = dstWorld.player

  linkThroughPortal(src.state.pos, src.state.quat, _playerPos, _playerQuat)
  dst.state.pos.copy(_playerPos).sub(dstWorld.originOffset)
  dst.state.quat.copy(_playerQuat)
  // Положение, ориентация И мировая скорость проходят через один rigid transform.
  // Простое copy оставляло пыль/факелы второго мира в осях первого и выдавало подмену.
  linkVectorThroughPortal(src.state.vel, _playerVel)
  dst.state.vel.copy(_playerVel)
  dst.state.angVel.copy(src.state.angVel)
  dst.state.scale = src.state.scale
  dst.alive = src.alive
  dst.cloaked = src.cloaked
  dst.hull = src.hull
  dst.shield = src.shield
  dst.energy = src.energy
  Object.assign(dst.controls, src.controls)
}

/**
 * Вторая система живёт с момента открытия портала. Игрок в ней — невзаимодействующий
 * связанный призрак: окружение честно шагает, а его поза строго совпадает с проходом.
 */
export function syncPreparedJumpWorld(source: Session, target: PreparedJumpWorld, dt: number): void {
  const dstWorld = target.world
  dstWorld.calendarTime = source.world.calendarTime
  target.session.running = source.running
  syncPreparedPlayer(source, target)

  if (source.running) {
    const wasAlive = dstWorld.player.alive
    // До фактического перехода копия игрока не должна дважды стрелять, собирать груз
    // или получать урон, но весь остальной мир обязан жить тем же stepWorld.
    dstWorld.player.alive = false
    syncPreparedControllers(target)
    stepWorld(dstWorld, dt, target.session.controllers)
    dstWorld.player.alive = wasAlive
    // Симуляция могла сдвинуть floating origin; привязываем призрак уже в новом кадре.
    syncPreparedPlayer(source, target)
  }

  // Оба мира используют одну временную фазу для материалов и орбит. Внутренние таймеры
  // destination уже получили тот же dt через stepWorld; это только устраняет дрейф float.
  dstWorld.time = source.world.time
}

export function syncDestCamera(main: Camera): PerspectiveCamera {
  const target = prepared
  if (!target) return emptyCamera
  const camera = target.camera
  if (main instanceof PerspectiveCamera) {
    camera.fov = main.fov
    camera.near = main.near
    camera.far = main.far
    camera.aspect = main.aspect
    camera.updateProjectionMatrix()
  }
  main.updateMatrixWorld(true)
  main.matrixWorld.decompose(_camPos, _camQuat, _camScale)
  linkThroughPortal(_camPos, _camQuat, camera.position, camera.quaternion)
  camera.position.sub(target.world.originOffset)
  camera.updateMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

export function destPortalScene(): Scene {
  return prepared?.scene ?? emptyScene
}

/** Готовый настоящий мир за маской. При пересечении он становится основным без повторного enterSystem. */
export function preparedJumpPortalWorld(): PreparedJumpWorld | null {
  return prepared
}

/** На кадр React-подмены рисуем уже прогретую destination Scene как основную. */
export function promotePreparedJumpPortalScene(target: PreparedJumpWorld): void {
  promoted = target
  if (prepared === target) prepared = null
}

export function promotedJumpPortalWorld(world?: World): PreparedJumpWorld | null {
  if (!promoted || (world && promoted.world !== world)) return null
  return promoted
}

/** Scene принятого World остаётся основной, пока session.world указывает на тот же объект. */
export function activeWorldRenderScene(fallback: Scene, world: World): Scene {
  return promotedJumpPortalWorld(world)?.scene ?? fallback
}

/**
 * После прохода прежний основной World уже является готовой обратной стороной тоннеля.
 * Сохраняем именно его, а не генерируем ту же систему повторно ради открытого портала назад.
 */
export function prepareReverseJumpPortalWorld(source: Session, reverseWorld: World): void {
  const p = jumpPortal()
  const camera = new PerspectiveCamera(70, 1, 0.5, 2e12)
  camera.matrixAutoUpdate = false
  const session: Session = {
    ...source,
    world: reverseWorld,
    controllers: new Map(),
    running: false,
    menuFlying: false,
    onOver: null,
    onDockChange: null,
    onSystemChange: null,
  }
  prepared = {
    // Совпадает с ключом prepareJumpPortalWorld: следующий React-тик обязан принять
    // сохранённый обратный World, а не решить, что цель новая, и вызвать enterSystem.
    key: `${source.world.galaxySeed}:${p.index}:${p.arrival ? JSON.stringify(p.arrival) : 'n'}`,
    scene: new Scene(),
    camera,
    world: reverseWorld,
    session,
  }
}

export function disposeJumpPortalWorld(): void {
  // Закрытие непройденного портала уничтожает только дальнюю комнату. Уже принятая
  // комната остаётся основным визуальным миром: повторный mount возвращал pop объектов.
  if (prepared !== promoted) prepared = null
}

/** Полный сброс между игровыми сессиями и изоляция тестов. */
export function resetJumpPortalWorlds(): void {
  prepared = null
  promoted = null
}
