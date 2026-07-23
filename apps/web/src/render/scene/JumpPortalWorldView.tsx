import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { Fragment, useEffect, useState, useSyncExternalStore } from 'react'
import { Quaternion, Vector3, type PerspectiveCamera } from 'three'
import { SessionScope, useSession } from '../../app/GameContext'
import { hlog } from '../../app/control/hyperLog'
import {
  jumpPortalRevision,
  portalActive,
  subscribeJumpPortal,
} from '../../app/control/jumpPortal'
import { Dust } from './Dust'
import {
  prepareJumpPortalWorld,
  promotedJumpPortalWorld,
  syncPreparedJumpWorld,
  type PreparedJumpWorld,
} from './jumpPortalWorld'
import { PortalRenderScope } from './portalRenderContext'
import { WorldVisuals } from './WorldVisuals'

function DestinationWorldSync({ source, target }: { source: ReturnType<typeof useSession>; target: PreparedJumpWorld }) {
  useFrame((_, dt) => {
    if (promotedJumpPortalWorld(source.world) !== target) syncPreparedJumpWorld(source, target, dt)
  }, -95)
  return null
}

const _camPos = new Vector3()
const _camQuat = new Quaternion()
const _camScale = new Vector3()

/**
 * После прохода комната стала основной, и рисует её уже НАСТОЯЩАЯ камера. Но портальный
 * store R3F запекает `camera` в момент своего создания (useMemo по контейнеру) и позже
 * сменой пропа его не переубедить — внутри комнаты `state.camera` навсегда остаётся
 * превью-камерой дальней стороны, которую после handoff никто не двигает.
 *
 * Поэтому камеру не подменяем, а ВЕДЁМ: каждый кадр копируем в неё позу реального глаза.
 * Иначе всё, что внутри читает `state.camera`, остаётся в точке прибытия — а это, в
 * частности, центр куба ближней пыли: после гиперпрыжка он молча уезжал за спину.
 *
 * −45: уже после `FlightCamera` (−50), которая ставит настоящий глаз, но до объектов сцены.
 */
function ActiveCameraSync({ view, target }: { view: PerspectiveCamera; target: PreparedJumpWorld }) {
  useFrame(() => {
    const camera = target.camera
    view.updateMatrixWorld(true)
    view.matrixWorld.decompose(_camPos, _camQuat, _camScale)
    camera.position.copy(_camPos)
    camera.quaternion.copy(_camQuat)
    camera.fov = view.fov
    camera.near = view.near
    camera.far = view.far
    camera.aspect = view.aspect
    camera.updateProjectionMatrix()
    // matrixAutoUpdate у этой камеры выключен (её позой владел портал) — обновляем сами.
    camera.updateMatrix()
    camera.updateMatrixWorld(true)
  }, -45)
  return null
}

/** Монтирует полный второй World в отдельную Scene, которую stencil-проход видит через кольцо. */
function WorldSlot({ source, target, active, viewCamera }: {
  source: ReturnType<typeof useSession>
  target: PreparedJumpWorld
  active: boolean
  viewCamera: PerspectiveCamera
}) {
  return createPortal(
    <SessionScope session={target.session}>
      <PortalRenderScope side={active ? 'source' : 'destination'}>
        {active
          ? <ActiveCameraSync view={viewCamera} target={target} />
          : <DestinationWorldSync source={source} target={target} />}
        <WorldVisuals />
        <Dust />
      </PortalRenderScope>
    </SessionScope>,
    target.scene,
    // Камера здесь ОДНА на всю жизнь портального store (R3F запекает её при создании и
    // проп больше не читает). До прохода её ведёт `syncDestCamera`, после — `ActiveCameraSync`.
    { camera: target.camera, scene: target.scene },
  )
}

/** После пересечения этот же React/three-подграф становится основным без remount. */
export function JumpPortalWorldView() {
  const source = useSession()
  const viewCamera = useThree((state) => state.camera as PerspectiveCamera)
  const revision = useSyncExternalStore(subscribeJumpPortal, jumpPortalRevision, jumpPortalRevision)
  /**
   * Второй мир строится ПОЗЖЕ нажатия, а не в его кадре. Сборка — полноценный `createWorld`
   * + `enterSystem` + жители, десятки миллисекунд; раньше она попадала ровно в тот кадр,
   * где кольцо только начинало раскрываться, и раскрытие начиналось рывком.
   *
   * Ждём два кадра: первый показывает уже нарисованное кольцо-затравку, во втором
   * считаем мир. Расти дальше затравки кольцу разрешит `markPortalDestinationDrawn`
   * — то есть кадр, в котором дальняя сцена реально нарисована. Всё тяжёлое, таким
   * образом, приходится на неподвижное маленькое кольцо, а движение остаётся гладким.
   */
  const [target, setTarget] = useState<PreparedJumpWorld | null>(null)
  useEffect(() => {
    // Прежняя цель снимается сразу: смена цели обязана погасить старую комнату в тот же
    // кадр, иначе пара кадров рисовалась бы уже отвязанная от портала сцена.
    setTarget(null)
    if (!portalActive()) {
      hlog('комната: портала нет, сборку не начинаем', { revision })
      return
    }
    hlog('комната: сборка дальнего мира запланирована', { revision })
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const built = prepareJumpPortalWorld(source)
        hlog('комната: дальний мир СОБРАН', { key: built.key, systemIndex: built.world.systemIndex })
        setTarget(built)
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [revision, source])
  const active = promotedJumpPortalWorld(source.world)
  const slots = active && target === active
    ? [active]
    : [active, target].filter((slot): slot is PreparedJumpWorld => slot !== null)

  return (
    <>
      {slots.map((slot) => (
        <Fragment key={slot.key}>
          <WorldSlot source={source} target={slot} active={slot === active} viewCamera={viewCamera} />
        </Fragment>
      ))}
    </>
  )
}
