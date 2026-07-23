import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Texture,
  Vector3,
} from 'three'
import type { BodyEntity } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import {
  BLACK_HOLE_DEFAULTS,
  createBlackHoleMaterial,
  type BlackHoleParams,
} from '../materials/blackHole'
import { worldShrink } from '../worldShrink'
import { addBlackHoleLens } from './blackHoleOverlay'
import { usePortalRenderSide } from './portalRenderContext'

/**
 * Чёрная дыра: чёрный горизонт + аккреционный диск + линза (шейдер на сфере снаружи).
 * Без звёздного билборда — он превращал объект в красный шар.
 *
 * Линза искажает УЖЕ НАРИСОВАННЫЙ КАДР, поэтому живёт не в сцене, а в проходе после неё
 * (`blackHoleOverlay`). Иначе ей доступна только текстура фона, и всё нарисованное
 * геометрией — планета, станции, трафик — в искажение не попадает: пузырь пробивает
 * в планете круглую дыру со звёздами.
 */

export type { BlackHoleParams }

const _axis = new Vector3()
const _cam = new Vector3()

function paramsFromHorizon(horizon: number, body: BodyEntity): BlackHoleParams {
  _axis.copy(body.spinAxis)
  if (_axis.lengthSq() < 1e-6) _axis.set(0, 1, 0)
  _axis.normalize()
  return {
    radius: horizon,
    diskAxis: _axis,
    diskInnerRadius: BLACK_HOLE_DEFAULTS.diskInner,
    diskOuterRadius: BLACK_HOLE_DEFAULTS.diskOuter,
    coronaIntensity: BLACK_HOLE_DEFAULTS.coronaIntensity,
    diskIntensity: BLACK_HOLE_DEFAULTS.diskIntensity,
    rotationSpeed: BLACK_HOLE_DEFAULTS.rotationSpeed,
    quality: BLACK_HOLE_DEFAULTS.quality,
  }
}

function BlackHoleInstance({ body }: { body: BodyEntity }) {
  const session = useSession()
  const coreRef = useRef<Mesh>(null)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  // В КОМНАТЕ портала кадра со «своими» телами нет — там своя сцена за stencil-маской.
  // Поэтому дальняя дыра остаётся обычным мешем со звёздным фоном, а линзу-в-проход
  // получает только основной мир. Ради углового случая двух дыр разом городить второй
  // проход незачем.
  const overlaid = usePortalRenderSide() === 'source'

  const horizon = body.radius

  const params = useMemo(() => paramsFromHorizon(horizon, body), [horizon, body.id, body.spinAxis.x, body.spinAxis.y, body.spinAxis.z])

  const skyTex = useMemo(() => {
    const bg = scene.background
    return bg instanceof Texture ? bg : null
  }, [scene.background])

  const lensGeo = useMemo(() => new IcosahedronGeometry(1, 5), [])
  const lensMat = useMemo(() => createBlackHoleMaterial(params, skyTex), [params, skyTex])
  const coreGeo = useMemo(() => new IcosahedronGeometry(1, 4), [])
  const coreMat = useMemo(() => new MeshBasicMaterial({ color: 0x000000 }), [])
  // Линза — свой объект, не JSX: в основном мире она живёт в проходе после кадра
  // (см. `blackHoleOverlay`), а не в дереве сцены. Мешем в сцене остаётся только ядро.
  const lens = useMemo(() => {
    const mesh = new Mesh(lensGeo, lensMat)
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    mesh.visible = false
    return mesh
  }, [lensGeo, lensMat])

  useEffect(() => {
    if (overlaid) return addBlackHoleLens(lens)
    scene.add(lens)
    return () => void scene.remove(lens)
  }, [overlaid, lens, scene])

  useEffect(() => () => {
    lensGeo.dispose()
    lensMat.dispose()
    coreGeo.dispose()
    coreMat.dispose()
  }, [lensGeo, lensMat, coreGeo, coreMat])

  useFrame(() => {
    const shrink = worldShrink(session.world.player.state.scale)
    if (shrink <= 0) {
      if (coreRef.current) coreRef.current.visible = false
      lens.visible = false
      return
    }
    const rs = horizon * shrink

    _cam.copy(camera.position).sub(body.pos)
    const dist = _cam.length()

    // Издали сфера примерно равна средней звезде. При подлёте она плавно сжимается,
    // оставаясь перед камерой: раньше камера входила внутрь сферы, линза выключалась
    // и на экране оставалось одно чёрное ядро.
    const fullInfluence = rs * BLACK_HOLE_DEFAULTS.influenceMultiplier
    const influence = Math.max(rs * 6, Math.min(fullInfluence, dist * 0.88))
    const lensOn = dist > rs * 6.2

    if (coreRef.current) {
      coreRef.current.visible = true
      coreRef.current.position.copy(body.pos)
      coreRef.current.scale.setScalar(rs * 1.02)
    }

    lens.visible = lensOn
    if (lensOn) {
      lens.position.copy(body.pos)
      lens.scale.setScalar(influence)
      lens.updateMatrixWorld()
      const u = lensMat.uniforms
      u.uBhCenter!.value.copy(body.pos)
      u.uCameraPos!.value.copy(camera.position)
      // Аккреционный диск имеет фазу времени мира, а не возраст React-компонента.
      // Поэтому ремоунт после портала не запускает чёрную дыру заново с нуля.
      u.uTime!.value = session.world.time
      u.uRs!.value = rs
      u.uInfluence!.value = influence
      u.uDiskInner!.value = params.diskInnerRadius * rs
      u.uDiskOuter!.value = params.diskOuterRadius * rs
      u.uSkyIntensity!.value = scene.backgroundIntensity
      const bg = scene.background
      if (bg instanceof Texture && u.uSkyMap!.value !== bg) {
        u.uSkyMap!.value = bg
        u.uHasSky!.value = true
      }
    }
  })

  // Ядро — обычный меш сцены: оно твёрдое и обязано честно закрывать собой всё, что
  // за ним, по буферу глубины. Линза добавляется отдельно (см. эффект выше).
  return <mesh ref={coreRef} geometry={coreGeo} material={coreMat} frustumCulled={false} renderOrder={0} />
}

export function BlackHole() {
  const session = useSession()
  const holes = session.world.bodies.filter((b) => b.kind === 'blackhole')
  if (holes.length === 0) return null
  return (
    <>
      {holes.map((body) => (
        <BlackHoleInstance key={body.id} body={body} />
      ))}
    </>
  )
}
