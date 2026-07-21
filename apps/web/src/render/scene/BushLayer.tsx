import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  Texture,
  Vector3,
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
/**
 * Ребро — лента: SEG отрезков, каждый = квад из 2 треугольников = 6 вершин. Рёбер не больше
 * числа узлов (у каждого узла один родитель, корень — без).
 */
const MAX_EDGE_VERTS = COUNT * SEG * 6

const _dummy = new Object3D()
const _mid: Vec4 = vec4()
const _bm = { x: 0, y: 0, z: 0 }
const _base = new Color(BUSH.BUBBLE_COLOR)

// Скретч ленты-ребра: спайн (SEG+1 точек) с туманом, локальная позиция камеры и рабочие
// векторы для камеро-ориентированной полуширины. Наружу не отдаются — только в буфер.
const _spx = new Float32Array(SEG + 1)
const _spy = new Float32Array(SEG + 1)
const _spz = new Float32Array(SEG + 1)
const _spf = new Float32Array(SEG + 1)
const _camLocal = new Vector3()
const _tan = new Vector3()
const _view = new Vector3()
const _side = new Vector3()
// Боковые рельсы ленты (спайн ± полуширина, развёрнутая к камере).
const _lx = new Float32Array(SEG + 1)
const _ly = new Float32Array(SEG + 1)
const _lz = new Float32Array(SEG + 1)
const _rx = new Float32Array(SEG + 1)
const _ry = new Float32Array(SEG + 1)
const _rz = new Float32Array(SEG + 1)

function easeInOutCubic(t: number): number {
  return smoothstep(0, 1, t)
}

/** Одна вершина ленты-ребра в буфер: позиция, вершинный цвет (с туманом), `aAcross` −1..+1. */
function emitEdgeVert(
  pos: Float32Array,
  col: Float32Array,
  acr: Float32Array,
  v: number,
  x: number,
  y: number,
  z: number,
  cr: number,
  cg: number,
  cb: number,
  across: number,
): void {
  pos[v * 3] = x
  pos[v * 3 + 1] = y
  pos[v * 3 + 2] = z
  col[v * 3] = cr
  col[v * 3 + 1] = cg
  col[v * 3 + 2] = cb
  acr[v] = across
}

export function BushLayer() {
  const session = useSession()
  const camera = useThree((s) => s.camera)

  const groupRef = useRef<Group>(null)
  const bubbleRef = useRef<InstancedMesh>(null)
  const edgeRef = useRef<Mesh>(null)
  const backdropRef = useRef<Mesh>(null)
  const crossRef = useRef<Group>(null)

  const proj = useMemo(() => makeBushProjection(COUNT), [])

  // Геометрия пузыря + СВОИ per-instance атрибуты (тон и туман каждого): собственные имена
  // не спорят с встроенным `instanceColor` three и держатся отдельно от матрицы инстанса.
  // Плоский квад −1..1 (билборд к камере) вместо сферы: пузыри — 2D-кружки с градиентом.
  const bubbleGeo = useMemo(() => {
    const g = new PlaneGeometry(2, 2)
    g.setAttribute('aTint', new InstancedBufferAttribute(new Float32Array(COUNT * 3), 3))
    g.setAttribute('aFog', new InstancedBufferAttribute(new Float32Array(COUNT), 1))
    return g
  }, [])
  const bubbleMat = useMemo(bushBubbleMaterial, [])

  const edgeGeo = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(MAX_EDGE_VERTS * 3), 3))
    g.setAttribute('aColor', new BufferAttribute(new Float32Array(MAX_EDGE_VERTS * 3), 3))
    g.setAttribute('aAcross', new BufferAttribute(new Float32Array(MAX_EDGE_VERTS), 1))
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

    // Слой сидит на корабле ПОЗИЦИЕЙ, но БЕЗ поворота (кадр выровнен по миру). Так осмотр
    // мышью крутит камеру вокруг неподвижной кроны, а не тащит крону за носом корабля.
    const ship = world.player.state
    group.position.copy(ship.pos)
    group.quaternion.identity()

    // КОМНАТА МОНУМЕНТА: крона гаснет, в пустоте висит один крест (мир − ship.pos → локаль
    // группы). Летаешь вокруг него свободно; отдаление считает `stepBush`.
    if (bush.inMonument && session.monumentCross) {
      bubbles.count = 0
      edges.geometry.setDrawRange(0, 0)
      const mc = session.monumentCross
      cross.visible = true
      cross.position.set(mc.x - ship.pos.x, mc.y - ship.pos.y, mc.z - ship.pos.z)
      cross.scale.setScalar(BUSH.MONUMENT_ROOM_CROSS_R)
      cross.quaternion.identity()
      syncCrossPortalSky(crossPortalMat, world.galaxySeed)
      tickCrossPortal(crossNeonMat, world.time)
      return
    }

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
      // Билборд: кружок всегда лицом к камере.
      _dummy.quaternion.copy(camera.quaternion)
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

    // РЁБРА-ЛЕНТЫ. Каждое — дуга-геодезическая ≈ квадратичная Безье, раздутая в неоновую
    // трубку: спайн ± полуширина, развёрнутая перпендикулярно взгляду. Камера в локали слоя
    // (слой сдвинут на ship.pos, повёрнут по миру) — из неё же строится билборд-полуширина.
    const posArr = edges.geometry.getAttribute('position').array as Float32Array
    const colArr = edges.geometry.getAttribute('aColor').array as Float32Array
    const acrArr = edges.geometry.getAttribute('aAcross').array as Float32Array
    const er = BUSH_EDGE_RGB.r
    const eg = BUSH_EDGE_RGB.g
    const eb = BUSH_EDGE_RGB.b
    _camLocal.copy(camera.position).sub(group.position)
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
      let cx = 2 * _bm.x - 0.5 * (ax + bx)
      let cy = 2 * _bm.y - 0.5 * (ay + by)
      let cz = 2 * _bm.z - 0.5 * (az + bz)
      // ВЫГИБ НАРУЖУ от центра кроны (начала координат): у самого игрока геодезические почти
      // прямые, оттого куст казался «жёстким». Толкаем контрольную точку по радиусу середины
      // на долю длины ребра — рёбра читаются живыми дугами. Чистая эстетика поверх геометрии.
      const mx = 0.5 * (ax + bx)
      const my = 0.5 * (ay + by)
      const mz = 0.5 * (az + bz)
      const mr = Math.hypot(mx, my, mz)
      if (mr > 1e-6) {
        const elen = Math.hypot(bx - ax, by - ay, bz - az)
        const push = (BUSH.EDGE_BULGE * elen) / mr
        cx += mx * push
        cy += my * push
        cz += mz * push
      }

      // Спайн: SEG+1 точек Безье (в метрах кадра) с интерполированным туманом.
      for (let k = 0; k <= SEG; k++) {
        const u = k / SEG
        const w0 = (1 - u) * (1 - u)
        const w1 = 2 * (1 - u) * u
        const w2 = u * u
        _spx[k] = (w0 * ax + w1 * cx + w2 * bx) * scaleM
        _spy[k] = (w0 * ay + w1 * cy + w2 * by) * scaleM
        _spz[k] = (w0 * az + w1 * cz + w2 * bz) * scaleM
        _spf[k] = lerp(fa, fb, u)
      }

      // Рельсы: касательная спайна × взгляд = поперечная ось ленты, полуширина ∝ туман (даль
      // тоньше, как и пузыри). Билборд к камере — трубка не «схлопывается» под любым углом.
      for (let k = 0; k <= SEG; k++) {
        const kp = k > 0 ? k - 1 : 0
        const kn = k < SEG ? k + 1 : SEG
        _tan.set(_spx[kn]! - _spx[kp]!, _spy[kn]! - _spy[kp]!, _spz[kn]! - _spz[kp]!)
        _view.set(_spx[k]! - _camLocal.x, _spy[k]! - _camLocal.y, _spz[k]! - _camLocal.z)
        _side.crossVectors(_tan, _view)
        const sl = _side.length()
        const halfW = Math.max(0.4, BUSH.EDGE_WIDTH_M * _spf[k]!)
        if (sl > 1e-6) _side.multiplyScalar(halfW / sl)
        else _side.set(halfW, 0, 0)
        _lx[k] = _spx[k]! - _side.x
        _ly[k] = _spy[k]! - _side.y
        _lz[k] = _spz[k]! - _side.z
        _rx[k] = _spx[k]! + _side.x
        _ry[k] = _spy[k]! + _side.y
        _rz[k] = _spz[k]! + _side.z
      }

      // Квады между соседними точками: два треугольника, `aAcross` −1 (левый рельс) / +1 (правый).
      for (let k = 0; k < SEG; k++) {
        if (v + 6 > MAX_EDGE_VERTS) break
        const f0 = _spf[k]!
        const f1 = _spf[k + 1]!
        const cr0 = er * f0
        const cg0 = eg * f0
        const cb0 = eb * f0
        const cr1 = er * f1
        const cg1 = eg * f1
        const cb1 = eb * f1
        emitEdgeVert(posArr, colArr, acrArr, v++, _lx[k]!, _ly[k]!, _lz[k]!, cr0, cg0, cb0, -1)
        emitEdgeVert(posArr, colArr, acrArr, v++, _rx[k]!, _ry[k]!, _rz[k]!, cr0, cg0, cb0, 1)
        emitEdgeVert(posArr, colArr, acrArr, v++, _lx[k + 1]!, _ly[k + 1]!, _lz[k + 1]!, cr1, cg1, cb1, -1)
        emitEdgeVert(posArr, colArr, acrArr, v++, _rx[k]!, _ry[k]!, _rz[k]!, cr0, cg0, cb0, 1)
        emitEdgeVert(posArr, colArr, acrArr, v++, _rx[k + 1]!, _ry[k + 1]!, _rz[k + 1]!, cr1, cg1, cb1, 1)
        emitEdgeVert(posArr, colArr, acrArr, v++, _lx[k + 1]!, _ly[k + 1]!, _lz[k + 1]!, cr1, cg1, cb1, -1)
      }
    }
    edges.geometry.getAttribute('position').needsUpdate = true
    edges.geometry.getAttribute('aColor').needsUpdate = true
    edges.geometry.getAttribute('aAcross').needsUpdate = true
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
        <mesh ref={edgeRef} geometry={edgeGeo} material={edgeMat} frustumCulled={false} />
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
