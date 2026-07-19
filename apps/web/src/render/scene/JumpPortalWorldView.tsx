import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { Fragment, useMemo, useSyncExternalStore } from 'react'
import type { PerspectiveCamera } from 'three'
import { SessionScope, useSession } from '../../app/GameContext'
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
        {!active && <DestinationWorldSync source={source} target={target} />}
        <WorldVisuals />
        <Dust />
      </PortalRenderScope>
    </SessionScope>,
    target.scene,
    // После handoff внутренние эффекты читают ту же camera, которой Post рисует сцену.
    { camera: active ? viewCamera : target.camera, scene: target.scene },
  )
}

/** После пересечения этот же React/three-подграф становится основным без remount. */
export function JumpPortalWorldView() {
  const source = useSession()
  const viewCamera = useThree((state) => state.camera as PerspectiveCamera)
  const revision = useSyncExternalStore(subscribeJumpPortal, jumpPortalRevision, jumpPortalRevision)
  const target = useMemo(
    () => portalActive() ? prepareJumpPortalWorld(source) : null,
    [revision, source],
  )
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
