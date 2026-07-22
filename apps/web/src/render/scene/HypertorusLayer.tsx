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
  Points,
  SphereGeometry,
} from 'three'
import { smoothstep } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { placeTorusAt, stepTorusFlight, torusView } from '../../app/control/torusFlight'
import { setTorusNav, torusAutopilotActive, torusTargetVertex } from '../../app/control/torusAutopilot'
import { bushExitScale } from '../../app/control/bushExit'
import { nameOfVertex, vertexOfNode } from './torusNodes'
import { TORUS } from '../config'
import { crossNeonTubesGeometry } from '../geometry/props'
import { crossNeonLampMaterial, tickCrossPortal } from '../materials/crossPortal'
import { torusDotMaterial, torusPuffMaterial } from '../materials/hypertorus'
import {
  applyPose,
  buildHypertorusGrid,
  slerpS3,
  stereoProject,
} from './hypertorus'

/**
 * Маркеры для HUD (локатор + рамка): мировые позиции ДОМА (твоя галактика) и КРЕСТА (монумент).
 * Слой считает их каждый кадр, HUD читает. `visible=false`, когда узел ушёл за полюс проекции.
 */
export const torusHomeMarker = { x: 0, y: 0, z: 0, visible: false }
export const torusMonumentMarker = { x: 0, y: 0, z: 0, visible: false }
/** Выбранная Tab галактика: маркер + имя. `visible=false`, когда цели нет или она за полюсом. */
export const torusTargetMarker = { x: 0, y: 0, z: 0, visible: false, name: '' }

/**
 * Подписи БЛИЖАЙШИХ галактик для HUD: имя узла + мировая позиция. Узел решётки = именованная
 * галактика (`universe.nodes[i]`). Держим только LABEL_COUNT самых ярких (ближних) — иначе экран
 * заклепало бы семьюстами имён. Слой заполняет каждый кадр, HUD рисует.
 */
export interface TorusLabel {
  x: number
  y: number
  z: number
  name: string
  /** Вершина решётки — по ней Tab выбирает цель, а прибытие ищет галактику. */
  vertex: number
}
export const torusLabels: { count: number; items: TorusLabel[] } = {
  count: 0,
  items: Array.from({ length: TORUS.LABEL_COUNT }, () => ({ x: 0, y: 0, z: 0, name: '', vertex: -1 })),
}

/**
 * Ближайшие галактики по возрастанию дальности — круг листания Tab. Заполняется тем же
 * отбором, что и подписи: что подписано на экране, то и выбирается, без второго списка.
 */
export const torusNearest: number[] = []

/**
 * СЛОЙ ГИПЕРТОРА — замкнутая вселенная-решётка на 3-сфере S³, снесённая СТЕРЕОГРАФИЧЕСКОЙ
 * проекцией. Показывается на рельсах комнаты (`session.bush.active`).
 *
 * Ключ к «настоящей стереографике»: игрок стоит в центре проекции, а W/S гонят S³ сквозь него
 * (`torusFlight` копит вид). Летит — решётка ВЫВОРАЧИВАЕТСЯ и течёт мимо, а не стоит статичным
 * шаром. Мышь вертит корабль (камера за кормой) — куда смотришь, туда и летишь.
 *
 * Галактики — мягкие туманные ПУФЫ в узлах, рёбра — нити ТОЧЕК-дотов. Решётка центрирована на
 * корабле (группа едет за ним), поэтому в пустой комнате она всегда вокруг тебя.
 */

/**
 * Решётка одна на игру и строится один раз. Наружу отдаётся картой мира: та считает по тем же
 * вершинам направления и дальности, поэтому «где галактика на карте» и «куда лететь в комнате»
 * не могут разойтись — источник один.
 */
export const GRID = buildHypertorusGrid(TORUS.NXI, TORUS.NTHETA, TORUS.NPHI)
const DPE = TORUS.DOTS_PER_EDGE
const MAX_DOTS = GRID.edgeCount * DPE

const _dummy = new Object3D()
const _base = new Color(TORUS.PUFF_COLOR)
const _p = { x: 0, y: 0, z: 0, depth: 0 }
const _rot = new Float64Array(GRID.vertCount * 4)
const _s4 = new Float64Array(4)
/**
 * Поставить игрока В УКАЗАННУЮ ВЕРШИНУ решётки (вход в комнату из своей галактики).
 * Сетка живёт здесь, поэтому и перевод «номер вершины → точка S³» тоже здесь.
 */
export function placeTorusAtVertex(vertex: number): void {
  const o = vertex * 4
  if (o < 0 || o + 3 >= GRID.verts.length) return
  placeTorusAt(GRID.verts[o]!, GRID.verts[o + 1]!, GRID.verts[o + 2]!, GRID.verts[o + 3]!)
}

/**
 * Ключ близости занятых слотов подписей за кадр — координата w узла (−1 = под игроком).
 * Пустой слот помечен двойкой: она больше любого возможного w, поэтому вытесняется первой.
 */
const _labelKey = new Float32Array(TORUS.LABEL_COUNT)
const LABEL_EMPTY = 2
/** Буферы упорядочивания подписей по близости. Выделены раз: в кадре аллокаций нет. */
const _order: number[] = []
const _sorted: TorusLabel[] = Array.from({ length: TORUS.LABEL_COUNT }, () => ({
  x: 0,
  y: 0,
  z: 0,
  name: '',
  vertex: -1,
}))

/**
 * Яркость — ТОЛЬКО по дальности проекции: она монотонна по настоящему расстоянию в S³
 * (r = SCALE·tg(γ/2), γ — угол от игрока), значит ближнее ярко, дальнее тонет.
 *
 * Здесь было ещё гашение по `depth=(1−w)/2` «в сторону антипода», и оно било в обратную
 * сторону: depth→1 — это НЕ дальняя половина, а точка, в которой стоишь сам. Оно выжигало
 * всё ближе ~37 м, так что вокруг корабля зияла чёрная дыра, а автопилот привозил в пустоту.
 */
function brightnessOf(dist: number): number {
  return 1 - smoothstep(TORUS.FOG_NEAR_M, TORUS.FOG_FAR_M, dist)
}

/**
 * Масштаб стереопроекции на этот кадр. Обычно константа, но на ВЫХОДЕ из комнаты растёт
 * (`bushExitScale`): решётка раздувается относительно точки выхода и уносится мимо камеры,
 * а дальний туман её доедает — комната пустеет ровно к тому мигу, когда экран станет чёрным.
 */
function projScale(): number {
  return TORUS.SCALE * bushExitScale()
}

/**
 * Радиус билборда галактики в метрах: угловой размер на S³, умноженный на множитель
 * стереопроекции k = SCALE/(1−w). Растёт при подлёте (у антипода k→SCALE/2, а дальность→0),
 * поэтому цель становится больше, а не меньше. Потолок — против взрыва размера у полюса.
 */
function puffRadius(w: number): number {
  const k = projScale() / Math.max(1e-4, 1 - w)
  return Math.min(TORUS.PUFF_MAX_R_M, TORUS.PUFF_ANGULAR_R * k)
}

/** Спроецировать узел `idx` (из `_rot`) в мировую позицию маркера HUD. Ушёл за полюс — скрыт. */
function updateNodeMarker(
  idx: number,
  groupPos: { x: number; y: number; z: number },
  marker: { x: number; y: number; z: number; visible: boolean },
): void {
  const o = idx * 4
  const w = _rot[o + 3]!
  if (w > TORUS.POLE_CULL) {
    marker.visible = false
    return
  }
  stereoProject(_rot[o]!, _rot[o + 1]!, _rot[o + 2]!, w, projScale(), _p)
  marker.x = _p.x + groupPos.x
  marker.y = _p.y + groupPos.y
  marker.z = _p.z + groupPos.z
  marker.visible = true
}

export function HypertorusLayer() {
  const session = useSession()
  const camera = useThree((s) => s.camera)

  const groupRef = useRef<Group>(null)
  const puffRef = useRef<InstancedMesh>(null)
  const dotRef = useRef<Points>(null)
  const backdropRef = useRef<Mesh>(null)
  const crossRef = useRef<Mesh>(null)

  const crossGeo = useMemo(crossNeonTubesGeometry, [])
  const crossMat = useMemo(crossNeonLampMaterial, [])

  const puffGeo = useMemo(() => {
    const g = new PlaneGeometry(2, 2)
    g.setAttribute('aTint', new InstancedBufferAttribute(new Float32Array(GRID.vertCount * 3), 3))
    g.setAttribute('aFog', new InstancedBufferAttribute(new Float32Array(GRID.vertCount), 1))
    return g
  }, [])
  const puffMat = useMemo(torusPuffMaterial, [])

  const dotGeo = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(MAX_DOTS * 3), 3))
    g.setAttribute('aBright', new BufferAttribute(new Float32Array(MAX_DOTS), 1))
    g.setDrawRange(0, 0)
    return g
  }, [])
  const dotMat = useMemo(torusDotMaterial, [])

  const backdropGeo = useMemo(() => new SphereGeometry(1, 16, 12), [])
  const backdropMat = useMemo(
    () => new MeshBasicMaterial({ color: 0x000306, side: BackSide, fog: false, depthWrite: true }),
    [],
  )

  useEffect(
    () => () => {
      puffGeo.dispose()
      puffMat.dispose()
      dotGeo.dispose()
      dotMat.dispose()
      backdropGeo.dispose()
      backdropMat.dispose()
      crossGeo.dispose()
      crossMat.dispose()
    },
    [puffGeo, puffMat, dotGeo, dotMat, backdropGeo, backdropMat, crossGeo, crossMat],
  )

  useFrame((_, dt) => {
    const { world, bush } = session
    const group = groupRef.current
    const puffs = puffRef.current
    const dots = dotRef.current
    const backdrop = backdropRef.current
    if (!group || !puffs || !dots || !backdrop) return

    const on = bush.active
    group.visible = on
    backdrop.visible = on
    if (!on) {
      puffs.count = 0
      dots.geometry.setDrawRange(0, 0)
      return
    }

    const ship = world.player.state
    // Решётка ЦЕНТРИРОВАНА на корабле (он стоит в начале координат комнаты), задник — за камерой.
    group.position.copy(ship.pos)
    group.quaternion.identity()
    backdrop.position.copy(camera.position)
    backdrop.scale.setScalar(TORUS.BACKDROP_RADIUS_M)

    // ПОЛЁТ: W/S/ПКМ гонят S³ сквозь игрока по носу корабля; накопленным видом двигаем решётку.
    stepTorusFlight(world.player.state.quat, Math.min(dt, 0.1))
    applyPose(GRID, torusView(), _rot)

    // ПУФЫ-галактики в узлах. Заодно отбираем ближайшие (самые яркие) под подписи имён.
    const universe = session.universe
    _labelKey.fill(LABEL_EMPTY)
    const gx = group.position.x
    const gy = group.position.y
    const gz = group.position.z
    const tintAttr = puffGeo.getAttribute('aTint') as InstancedBufferAttribute
    const fogAttr = puffGeo.getAttribute('aFog') as InstancedBufferAttribute
    const tint = tintAttr.array as Float32Array
    const fogArr = fogAttr.array as Float32Array
    let count = 0
    for (let i = 0; i < GRID.vertCount; i++) {
      const o = i * 4
      const w = _rot[o + 3]!
      if (w > TORUS.POLE_CULL) continue
      stereoProject(_rot[o]!, _rot[o + 1]!, _rot[o + 2]!, w, projScale(), _p)
      const dist = Math.hypot(_p.x, _p.y, _p.z)
      const fog = brightnessOf(dist)
      if (fog < 0.02) continue
      _dummy.position.set(_p.x, _p.y, _p.z)
      _dummy.scale.setScalar(puffRadius(w))
      _dummy.quaternion.copy(camera.quaternion)
      _dummy.updateMatrix()
      puffs.setMatrixAt(count, _dummy.matrix)
      tint[count * 3] = _base.r
      tint[count * 3 + 1] = _base.g
      tint[count * 3 + 2] = _base.b
      fogArr[count] = fog
      count++

      // Подпись: вершина = именованная галактика. Держим топ-LABEL_COUNT БЛИЖАЙШИХ, а
      // близость меряем координатой w: у игрока w=−1, у противоположного края S³ w=+1, и
      // между ними она монотонна по настоящему расстоянию (γ = acos(−w)). Яркость на эту
      // роль не годится — туман насыщается в единицу ближе сорока метров, а там лежит
      // десятая часть решётки: восемь десятков узлов получали ОДИН ключ, и «ближайшие»
      // выходили случайной выборкой из них. Крест не подписываем — у него своя рамка.
      if (i !== TORUS.MONUMENT_NODE) {
        let farSlot = 0
        for (let s = 1; s < _labelKey.length; s++) if (_labelKey[s]! > _labelKey[farSlot]!) farSlot = s
        if (w < _labelKey[farSlot]!) {
          _labelKey[farSlot] = w
          const lab = torusLabels.items[farSlot]!
          lab.x = _p.x + gx
          lab.y = _p.y + gy
          lab.z = _p.z + gz
          lab.name = nameOfVertex(universe, i)
          lab.vertex = i
        }
      }
    }
    puffs.count = count
    // Слоты заполнялись в произвольном порядке — упорядочиваем по возрастанию w, то есть от
    // ближней галактики к дальней: в этом порядке Tab их и листает.
    const slots = _order
    slots.length = 0
    for (let s = 0; s < _labelKey.length; s++) if (_labelKey[s]! < LABEL_EMPTY) slots.push(s)
    slots.sort((a, b) => _labelKey[a]! - _labelKey[b]!)
    torusNearest.length = 0
    for (let k = 0; k < slots.length; k++) {
      const src = torusLabels.items[slots[k]!]!
      const dst = _sorted[k]!
      dst.x = src.x
      dst.y = src.y
      dst.z = src.z
      dst.name = src.name
      dst.vertex = src.vertex
      torusNearest.push(src.vertex)
    }
    for (let k = 0; k < slots.length; k++) {
      const src = _sorted[k]!
      const dst = torusLabels.items[k]!
      dst.x = src.x
      dst.y = src.y
      dst.z = src.z
      dst.name = src.name
      dst.vertex = src.vertex
    }
    torusLabels.count = slots.length
    puffs.instanceMatrix.needsUpdate = true
    tintAttr.needsUpdate = true
    fogAttr.needsUpdate = true

    // РЁБРА-ДОТЫ: DPE точек вдоль дуги (slerp в S³), спроецированы. Точка у полюса — пропуск.
    const posArr = dots.geometry.getAttribute('position').array as Float32Array
    const brightArr = dots.geometry.getAttribute('aBright').array as Float32Array
    let d = 0
    for (let e = 0; e < GRID.edgeCount; e++) {
      const i = GRID.edges[e * 2]!
      const j = GRID.edges[e * 2 + 1]!
      for (let k = 0; k < DPE; k++) {
        const t = (k + 1) / (DPE + 1)
        slerpS3(_rot, i, j, t, _s4)
        const w = _s4[3]!
        if (w > TORUS.POLE_CULL) continue
        stereoProject(_s4[0]!, _s4[1]!, _s4[2]!, w, projScale(), _p)
        const b = brightnessOf(Math.hypot(_p.x, _p.y, _p.z))
        if (b < 0.02) continue
        posArr[d * 3] = _p.x
        posArr[d * 3 + 1] = _p.y
        posArr[d * 3 + 2] = _p.z
        brightArr[d] = b
        d++
      }
    }
    dots.geometry.getAttribute('position').needsUpdate = true
    dots.geometry.getAttribute('aBright').needsUpdate = true
    dots.geometry.setDrawRange(0, d)

    // ДОМ — узел, ИЗ КОТОРОГО влетел (его записал `enterBush`), а не постоянный номер:
    // вылетев в другую галактику и войдя в её дыру, домом становится она.
    updateNodeMarker(vertexOfNode(bush.node), group.position, torusHomeMarker)

    // КРЕСТ-МОНУМЕНТ — отдельный узел, помечен неоновым крестом (якорь + цель автопилота №2).
    const cross = crossRef.current
    const mo = TORUS.MONUMENT_NODE * 4
    const mw = _rot[mo + 3]!
    updateNodeMarker(TORUS.MONUMENT_NODE, group.position, torusMonumentMarker)
    if (cross) {
      if (mw > TORUS.POLE_CULL) {
        cross.visible = false
      } else {
        stereoProject(_rot[mo]!, _rot[mo + 1]!, _rot[mo + 2]!, mw, projScale(), _p)
        cross.visible = true
        cross.position.set(_p.x, _p.y, _p.z)
        cross.scale.setScalar(puffRadius(mw) * TORUS.CROSS_SCALE)
        cross.quaternion.copy(camera.quaternion)
        tickCrossPortal(crossMat, world.time)
      }
    }

    // ВЫБРАННАЯ ЦЕЛЬ: своя рамка на HUD (по ней и рулишь) + направление для автопилота.
    // «Прибыл» — когда w у −1: узел пришёл в центр проекции, то есть ты внутри него.
    const targetVertex = torusTargetVertex()
    if (targetVertex === null) {
      torusTargetMarker.visible = false
    } else {
      const o = targetVertex * 4
      const w = _rot[o + 3]!
      updateNodeMarker(targetVertex, group.position, torusTargetMarker)
      torusTargetMarker.name = nameOfVertex(universe, targetVertex)
      if (torusAutopilotActive()) {
        stereoProject(_rot[o]!, _rot[o + 1]!, _rot[o + 2]!, w, projScale(), _p)
        const len = Math.hypot(_p.x, _p.y, _p.z)
        const arrived = w < TORUS.AUTOPILOT_ARRIVE_W
        if (len > 1e-3) setTorusNav(_p.x / len, _p.y / len, _p.z / len, true, arrived)
        else setTorusNav(0, 0, 0, false, arrived)
      }
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
        <instancedMesh ref={puffRef} args={[puffGeo, puffMat, GRID.vertCount]} frustumCulled={false} />
        <points ref={dotRef} geometry={dotGeo} material={dotMat} frustumCulled={false} />
        <mesh ref={crossRef} geometry={crossGeo} material={crossMat} frustumCulled={false} visible={false} />
      </group>
    </>
  )
}
