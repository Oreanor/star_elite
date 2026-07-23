import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Quaternion, Vector3 } from 'three'
import { adoptPreparedJumpWorld, useSession } from '../../app/GameContext'
import { queueCameraFrameRotation } from '../../app/control/cameraView'
import {
  cancelPortalCommit,
  completePortalTransit,
  jumpPortal,
  linkThroughPortal,
  linkVectorThroughPortal,
  portalOpen,
  tickPortal,
} from '../../app/control/jumpPortal'
import {
  disposeJumpPortalWorld,
  preparedJumpPortalWorld,
  promotePreparedJumpPortalScene,
} from './jumpPortalWorld'
import { clearSharedPortal, publishSharedPortal } from '../../app/net/portal'
import { isHeld } from '../../platform/input/input'

const _destPos = new Vector3()
const _destQuat = new Quaternion()
const _destVel = new Vector3()
const _angVel = new Vector3()
const _destCameraPos = new Vector3()
const _destCameraQuat = new Quaternion()
const _cameraSourceInv = new Quaternion()
const _cameraFrameRotation = new Quaternion()

/**
 * Портал прыжка: тик пересечения диска и атомарная смена системы на его плоскости.
 * Визуал кольца/второй комнаты — в Post (stencil pass).
 * Живёт ВНЕ ключа сцены — подмена мира не сносит постановщика.
 */
export function JumpDirector() {
  const session = useSession()
  useFrame(({ camera }, dt) => {
    if (!portalOpen()) return
    const ev = tickPortal(session.world, Math.min(dt, 0.1), isHeld('KeyH'), performance.now() / 1000)
    if (ev === 'close') {
      disposeJumpPortalWorld()
      return
    }
    if (ev !== 'cross') return

    // Точку, ориентацию и мировую скорость вычисляем ДО `jump`: тот пересобирает мир
    // и обнуляет кинематику. Угловая скорость задана в связанных осях корабля,
    // поэтому её компоненты при жёстком повороте портала не меняются.
    const state = session.world.player.state
    linkThroughPortal(state.pos, state.quat, _destPos, _destQuat)
    linkVectorThroughPortal(state.vel, _destVel)
    // Последний кадр превью уже смотрит из этой связанной позы. Перенос камеры тем же
    // преобразованием делает первый кадр новой сцены буквально его продолжением.
    linkThroughPortal(camera.position, camera.quaternion, _destCameraPos, _destCameraQuat)
    _cameraSourceInv.copy(camera.quaternion).invert()
    _cameraFrameRotation.multiplyQuaternions(_destCameraQuat, _cameraSourceInv)
    _angVel.copy(state.angVel)

    const p = jumpPortal()
    const prepared = preparedJumpPortalWorld()
    if (
      prepared?.world.systemIndex === p.index
      && adoptPreparedJumpWorld(session, prepared.world, p.index)
    ) {
      const next = session.world.player.state
      // `destPos` живёт в абсолютных координатах системы, а симуляция — в локальных
      // координатах плавающего начала отсчёта.
      next.pos.copy(_destPos).sub(session.world.originOffset)
      next.quat.copy(_destQuat)
      next.vel.copy(_destVel)
      next.angVel.copy(_angVel)
      camera.position.copy(_destCameraPos).sub(session.world.originOffset)
      camera.quaternion.copy(_destCameraQuat)
      camera.updateMatrixWorld(true)
      queueCameraFrameRotation(_cameraFrameRotation)
      promotePreparedJumpPortalScene(prepared)
      // Успешный пролёт закрывает кольцо. Prepared Scene остаётся только на короткий
      // handoff до монтажа основного WorldVisuals новой системы.
      completePortalTransit(session.world)
    } else {
      cancelPortalCommit()
    }
  }, -90)
  return null
}

/** Сетевой пульс пары устьев и путешественника; RTDB живёт вне чистой симуляции. */
export function PortalPublisher() {
  const session = useSession()
  const acc = useRef(0)
  const published = useRef(false)

  useEffect(() => () => {
    if (published.current) void clearSharedPortal()
  }, [])

  useFrame((_, dt) => {
    const p = jumpPortal()
    if (!portalOpen() || !p.destReady) {
      if (published.current) {
        published.current = false
        void clearSharedPortal()
      }
      return
    }
    acc.current += dt
    if (published.current && acc.current < 1 / 12) return
    acc.current = 0
    published.current = true
    void publishSharedPortal(session.world)
  })
  return null
}
