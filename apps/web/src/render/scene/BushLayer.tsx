import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
  Texture,
} from 'three'
import {
  UNIVERSE,
  clamp,
  geodesicMidpoint,
  lerp,
  smoothstep,
  toBall,
  vec4,
  type Vec4,
} from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { BUSH } from '../config'
import {
  crossNeonTubesGeometry,
  crossPortalPanelsGeometry,
  crossStationGeometry,
} from '../geometry/props'
import {
  crossBodyMaterial,
  crossNeonLampMaterial,
  crossPortalMaterial,
  syncCrossPortalSky,
  tickCrossPortal,
} from '../materials/crossPortal'
import { BUSH_EDGE_RGB, bushBubbleMaterial, bushEdgeMaterial } from '../materials/bush'
import { makeBushProjection, projectBush } from './bushView'

/**
 * СЛОЙ КУСТА: тёмная комната вселенной, что проявляется на рельсах (`session.bush.active`).
 *
 * Узлы — мыльные пузыри-галактики (`InstancedMesh`), рёбра — неоновые дуги (`LineSegments`),
 * всё из `toBall`-проекции в кадр игрока (`bushView`). Игрок стоит в начале координат, куст
 * выворачивается вокруг него; при входе граф схлопывается в тебя из десятикратного размера.
 *
 * Слой якорится к КОРАБЛЮ (позиция и ориентация): камера преследования смотрит ему в корму,
 * и крона расходится впереди. Тёмный задник-сфера вокруг камеры прячет старый мир — отсюда
 * «комната», а не оверлей поверх системы.
 *
 * Ни одной аллокации в кадре: буферы проекции, инстансов и линий выделены один раз.
 */

const COUNT = UNIVERSE.COUNT
const MONUMENT = UNIVERSE.MONUMENT_NODE
const SEG = BUSH.EDGE_SEGMENTS
/** Каждое ребро — SEG отрезков = SEG·2 вершин; рёбер не больше числа узлов минус корень. */
const MAX_EDGE_VERTS = COUNT * SEG * 2

const _dummy = new Object3D()
const _mid: Vec4 = vec4()
const _bm = { x: 0, y: 0, z: 0 }
const _base = new Color(BUSH.BUBBLE_COLOR)

function easeInOutCubic(t: number): number {
  return smoothstep(0, 1, t)
}

export function BushLayer() {
  const session = useSession()
  const camera = useThree((s) => s.camera)

  const groupRef = useRef<Group>(null)
  const bubbleRef = useRef<InstancedMesh>(null)
  const edgeRef = useRef<LineSegments>(null)
  const backdropRef = useRef<Mesh>(null)
  const crossRef = useRef<Group>(null)

  const proj = useMemo(() => makeBushProjection(COUNT), [])

  // Геометрия пузыря + СВОИ per-instance атрибуты (тон и туман каждого): собственные имена
  // не спорят с встроенным `instanceColor` three и держатся отдельно от матрицы инстанса.
  const bubbleGeo = useMemo(() => {
    const g = new IcosahedronGeometry(1, 1)
    g.setAttribute('aTint', new InstancedBufferAttribute(new Float32Array(COUNT * 3), 3))
    g.setAttribute('aFog', new InstancedBufferAttribute(new Float32Array(COUNT), 1))
    return g
  }, [])
  const bubbleMat = useMemo(bushBubbleMaterial, [])

  const edgeGeo = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(MAX_EDGE_VERTS * 3), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(MAX_EDGE_VERTS * 3), 3))
    g.setDrawRange(0, 0)
    return g
  }, [])
  const edgeMat = useMemo(bushEdgeMaterial, [])

  const backdropGeo = useMemo(() => new SphereGeometry(1, 16, 12), [])
  const backdropMat = useMemo(
    () => new MeshBasicMaterial({ color: 0x000306, side: BackSide, fog: false, depthWrite: true }),
    [],
  )

  // Монумент — крест той же моделью, что у причала: чёрный корпус, окна-скайбокс, неон.
  const crossPortalMat = useMemo(crossPortalMaterial, [])
  const crossNeonMat = useMemo(crossNeonLampMaterial, [])

  useEffect(
    () => () => {
      bubbleGeo.dispose()
      bubbleMat.dispose()
      edgeGeo.dispose()
      edgeMat.dispose()
      backdropGeo.dispose()
      backdropMat.dispose()
      const sky = crossPortalMat.uniforms.uSkyMap!.value as Texture | null
      sky?.dispose()
      crossPortalMat.dispose()
      crossNeonMat.dispose()
    },
    [bubbleGeo, bubbleMat, edgeGeo, edgeMat, backdropGeo, backdropMat, crossPortalMat, crossNeonMat],
  )

  const introStart = useRef<number | null>(null)

  useFrame(() => {
    const { world, bush, universe } = session
    const group = groupRef.current
    const bubbles = bubbleRef.current
    const edges = edgeRef.current
    const backdrop = backdropRef.current
    const cross = crossRef.current
    if (!group || !bubbles || !edges || !backdrop || !cross) return

    const on = bush.active
    group.visible = on
    backdrop.visible = on
    if (!on) {
      introStart.current = null
      bubbles.count = 0
      edges.geometry.setDrawRange(0, 0)
      cross.visible = false
      return
    }

    // Задник ездит с камерой — тёмная сфера изнанкой прячет старый мир за собой.
    backdrop.position.copy(camera.position)
    backdrop.scale.setScalar(BUSH.BACKDROP_RADIUS_M)

    // Слой сидит на корабле: его позиция и ориентация. Крона расходится перед кормой.
    group.position.copy(world.player.state.pos)
    group.quaternion.copy(world.player.state.quat)

    // Интро: из ×INTRO_SCALE схлопывается в тебя за INTRO_SECONDS. Центр — начало координат.
    if (introStart.current == null) introStart.current = world.time
    const introT = clamp((world.time - introStart.current) / BUSH.INTRO_SECONDS, 0, 1)
    const introScale = lerp(BUSH.INTRO_SCALE, 1, easeInOutCubic(introT))
    const scaleM = BUSH.BALL_RADIUS_M * introScale

    projectBush(universe, bush, proj)
    const ball = proj.ball
    const fog = proj.fog

    // ПУЗЫРИ. Свой узел (fog→1, начало координат) и монумент пропускаем.
    const tintAttr = bubbleGeo.getAttribute('aTint') as InstancedBufferAttribute
    const fogAttr = bubbleGeo.getAttribute('aFog') as InstancedBufferAttribute
    const tint = tintAttr.array as Float32Array
    const fogArr = fogAttr.array as Float32Array
    let count = 0
    for (let i = 0; i < COUNT; i++) {
      const f = fog[i]!
      if (f < BUSH.FOG_CULL || f > BUSH.SELF_FOG) continue
      if (i === MONUMENT) continue
      const r = Math.max(BUSH.BUBBLE_MIN_R_M, BUSH.BUBBLE_RADIUS_M * f)
      _dummy.position.set(ball[i * 3]! * scaleM, ball[i * 3 + 1]! * scaleM, ball[i * 3 + 2]! * scaleM)
      _dummy.scale.setScalar(r)
      _dummy.quaternion.identity()
      _dummy.updateMatrix()
      bubbles.setMatrixAt(count, _dummy.matrix)
      tint[count * 3] = _base.r
      tint[count * 3 + 1] = _base.g
      tint[count * 3 + 2] = _base.b
      fogArr[count] = f
      count++
    }
    bubbles.count = count
    bubbles.instanceMatrix.needsUpdate = true
    tintAttr.needsUpdate = true
    fogAttr.needsUpdate = true

    // РЁБРА. Каждое — дуга-геодезическая ≈ квадратичная Безье через середину геодезической.
    const posArr = edges.geometry.getAttribute('position').array as Float32Array
    const colArr = edges.geometry.getAttribute('color').array as Float32Array
    const er = BUSH_EDGE_RGB.r
    const eg = BUSH_EDGE_RGB.g
    const eb = BUSH_EDGE_RGB.b
    let v = 0
    for (let i = 0; i < COUNT; i++) {
      const p = universe.nodes[i]!.parent
      if (p < 0) continue
      const fa = fog[i]!
      const fb = fog[p]!
      if (fa < BUSH.FOG_CULL && fb < BUSH.FOG_CULL) continue

      const ax = ball[i * 3]!
      const ay = ball[i * 3 + 1]!
      const az = ball[i * 3 + 2]!
      const bx = ball[p * 3]!
      const by = ball[p * 3 + 1]!
      const bz = ball[p * 3 + 2]!
      // Контрольная точка Безье через середину геодезической в шаре (см. bezier §6).
      geodesicMidpoint(proj.hPoints[i]!, proj.hPoints[p]!, _mid)
      toBall(_mid, _bm)
      const cx = 2 * _bm.x - 0.5 * (ax + bx)
      const cy = 2 * _bm.y - 0.5 * (ay + by)
      const cz = 2 * _bm.z - 0.5 * (az + bz)

      let px = 0
      let py = 0
      let pz = 0
      let pr = 0
      let pg = 0
      let pb = 0
      for (let k = 0; k <= SEG; k++) {
        const u = k / SEG
        const w0 = (1 - u) * (1 - u)
        const w1 = 2 * (1 - u) * u
        const w2 = u * u
        const x = (w0 * ax + w1 * cx + w2 * bx) * scaleM
        const y = (w0 * ay + w1 * cy + w2 * by) * scaleM
        const z = (w0 * az + w1 * cz + w2 * bz) * scaleM
        const ff = lerp(fa, fb, u)
        const cr = er * ff
        const cg = eg * ff
        const cb = eb * ff
        if (k > 0 && v + 2 <= MAX_EDGE_VERTS) {
          posArr[v * 3] = px
          posArr[v * 3 + 1] = py
          posArr[v * 3 + 2] = pz
          colArr[v * 3] = pr
          colArr[v * 3 + 1] = pg
          colArr[v * 3 + 2] = pb
          v++
          posArr[v * 3] = x
          posArr[v * 3 + 1] = y
          posArr[v * 3 + 2] = z
          colArr[v * 3] = cr
          colArr[v * 3 + 1] = cg
          colArr[v * 3 + 2] = cb
          v++
        }
        px = x
        py = y
        pz = z
        pr = cr
        pg = cg
        pb = cb
      }
    }
    edges.geometry.getAttribute('position').needsUpdate = true
    edges.geometry.getAttribute('color').needsUpdate = true
    edges.geometry.setDrawRange(0, v)

    // МОНУМЕНТ — крест в корне куста как маяк, виден издалека.
    const mf = fog[MONUMENT]!
    if (mf >= BUSH.FOG_CULL) {
      cross.visible = true
      cross.position.set(
        ball[MONUMENT * 3]! * scaleM,
        ball[MONUMENT * 3 + 1]! * scaleM,
        ball[MONUMENT * 3 + 2]! * scaleM,
      )
      cross.scale.setScalar(Math.max(BUSH.BUBBLE_MIN_R_M, BUSH.BUBBLE_RADIUS_M * mf) * 1.3)
      syncCrossPortalSky(crossPortalMat, world.galaxySeed)
      tickCrossPortal(crossNeonMat, world.time)
    } else {
      cross.visible = false
    }
  })

  return (
    <>
      <mesh
        ref={backdropRef}
        geometry={backdropGeo}
        material={backdropMat}
        frustumCulled={false}
        visible={false}
        renderOrder={-10}
      />
      <group ref={groupRef} frustumCulled={false} visible={false}>
        <instancedMesh
          ref={bubbleRef}
          args={[bubbleGeo, bubbleMat, COUNT]}
          frustumCulled={false}
        />
        <lineSegments ref={edgeRef} geometry={edgeGeo} material={edgeMat} frustumCulled={false} />
        <group ref={crossRef} frustumCulled={false} visible={false}>
          <mesh geometry={crossStationGeometry()} material={crossBodyMaterial()} frustumCulled={false} />
          <mesh geometry={crossPortalPanelsGeometry()} material={crossPortalMat} frustumCulled={false} />
          <mesh
            geometry={crossNeonTubesGeometry()}
            material={crossNeonMat}
            frustumCulled={false}
            renderOrder={1}
          />
        </group>
      </group>
    </>
  )
}
