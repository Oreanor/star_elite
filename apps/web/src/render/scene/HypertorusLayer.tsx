import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  SphereGeometry,
} from 'three'
import { quasarOf, smoothstep, renderTime } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { placeTorusAt, torusThrust, torusView } from '../../session/torusFlight'
import { finishTorusApproach, setTorusNav, torusAutopilotActive, torusTargetVertex } from '../../session/torusAutopilot'
import { bushExitScale } from '../../session/bushExit'
import { nameOfVertex, nodeOfVertex, vertexOfNode } from './torusNodes'
import { TORUS } from '../config'
import { torusTuning } from './torusTuning'
import { crossNeonTubesGeometry } from '../geometry/props'
import { crossNeonLampMaterial, tickCrossPortal } from '../materials/crossPortal'
import { torusDotMaterial, torusPuffMaterial } from '../materials/hypertorus'
import {
  applyPose,
  buildHypertorusGrid,
  slerpS3,
  stereoProject,
} from '@elite/sim'

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

/**
 * Разброс точек нити — раз на модуль и по зерну, а не `Math.random` в кадре: иначе волокна
 * кипели бы, а не висели. Смещение поперёк — почти-гаусс (сумма трёх равномерных): точки
 * гуще у оси нити и редеют к краям, поэтому край выходит дымным, а не стриженым.
 * Сдвиг вдоль дуги — внутри своей доли ребра, чтобы точки не сбивались в бусины.
 */
const _jitter = new Float32Array(MAX_DOTS * 3)
const _along = new Float32Array(MAX_DOTS)
{
  let h = 0x2f6b9a1d
  const rnd = (): number => {
    h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296
  }
  const gauss = (): number => rnd() + rnd() + rnd() - 1.5
  for (let i = 0; i < MAX_DOTS; i++) {
    _jitter[i * 3] = gauss()
    _jitter[i * 3 + 1] = gauss()
    _jitter[i * 3 + 2] = gauss()
    _along[i] = rnd() - 0.5
  }
}

const _dummy = new Object3D()
const _base = new Color(TORUS.PUFF_COLOR)
/**
 * КВАЗАРЫ в клубке — ориентиры: пуф ярче, холоднее и крупнее, и сквозь него два луча-джета.
 * Остальные семьсот узлов одинаковы, и без ориентиров комната S³ читается как однородная каша.
 */
const _quasarTint = new Color(0xd6eeff)
const QUASAR_PUFF_GROW = 1.7
/** Длина джета — в радиусах пуфа: столб заметно длиннее самой галактики. */
const QUASAR_JET_PUFFS = 6
const _p = { x: 0, y: 0, z: 0, depth: 0 }
/**
 * Ручной выход: была ли ВЫБРАННАЯ цель уже в центре проекции в прошлом кадре, и какая это была
 * цель. Выход ловит именно ВХОД в узел своим ходом — выбрать узел, в котором стоишь, не значит
 * из него выпасть, а смена цели переписывает отметку без выхода.
 */
let _manualPrevTarget: number | null = null
let _manualWasInside = true
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
  // Туман растягивается вместе с раздвижкой: видно те же узлы, что и без неё, только реже.
  const spread = torusTuning.spread
  return 1 - smoothstep(TORUS.FOG_NEAR_M * spread, TORUS.FOG_FAR_M * spread, dist)
}

/**
 * Масштаб стереопроекции на этот кадр. Обычно константа, но на ВЫХОДЕ из комнаты растёт
 * (`bushExitScale`): решётка раздувается относительно точки выхода и уносится мимо камеры,
 * а дальний туман её доедает — комната пустеет ровно к тому мигу, когда экран станет чёрным.
 */
function projScale(): number {
  return TORUS.SCALE * torusTuning.spread * bushExitScale()
}

/**
 * Радиус билборда галактики в метрах: угловой размер на S³, умноженный на множитель
 * стереопроекции k = SCALE/(1−w). Растёт при подлёте (у антипода k→SCALE/2, а дальность→0),
 * поэтому цель становится больше, а не меньше. Потолок — против взрыва размера у полюса.
 */
function puffRadius(w: number): number {
  // Без раздвижки: она разносит узлы, а размер галактики остаётся прежним.
  const k = (TORUS.SCALE * bushExitScale()) / Math.max(1e-4, 1 - w)
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

  // Квазар ли узел и ось его джета — один раз на вселенную: зерно галактики не меняется.
  const quasarAxes = useMemo(() => {
    const axes: (readonly [number, number, number] | null)[] = []
    for (let v = 0; v < GRID.vertCount; v++) {
      const node = session.universe.nodes[nodeOfVertex(v)]
      axes.push(node && v !== TORUS.MONUMENT_NODE ? quasarOf(node.seed) : null)
    }
    return axes
  }, [session.universe])
  const jetGeo = useMemo(() => {
    const n = quasarAxes.filter(Boolean).length
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(Math.max(1, n) * 4 * 3), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(Math.max(1, n) * 4 * 3), 3))
    g.setDrawRange(0, 0)
    return g
  }, [quasarAxes])
  const jetMat = useMemo(
    () => new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }),
    [],
  )
  useEffect(() => () => {
    jetGeo.dispose()
    jetMat.dispose()
  }, [jetGeo, jetMat])
  const jetRef = useRef<LineSegments>(null)

  const backdropGeo = useMemo(() => new SphereGeometry(1, 16, 12), [])
  const backdropMat = useMemo(
    () => new MeshBasicMaterial({ color: TORUS.BACKDROP_COLOR, side: BackSide, fog: false, depthWrite: true }),
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

  useFrame(() => {
    const { world, bush } = session
    const group = groupRef.current
    const puffs = puffRef.current
    const dots = dotRef.current
    const backdrop = backdropRef.current
    if (!group || !puffs || !dots || !backdrop) return

    const on = bush.active
    puffMat.uniforms.uGain!.value = torusTuning.puff
    dotMat.uniforms.uGain!.value = torusTuning.dot
    group.visible = on
    backdrop.visible = on
    if (!on) {
      puffs.count = 0
      dots.geometry.setDrawRange(0, 0)
      jetGeo.setDrawRange(0, 0)
      return
    }

    const ship = world.player.state
    // Решётка ЦЕНТРИРОВАНА на корабле (он стоит в начале координат комнаты), задник — за камерой.
    group.position.copy(ship.pos)
    group.quaternion.identity()
    backdrop.position.copy(camera.position)
    backdrop.scale.setScalar(TORUS.BACKDROP_RADIUS_M)

    // ПОЛЁТ (W/S/ПКМ гонят S³ сквозь игрока) шагает в такте мира; здесь только читаем вид.
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
    const jetPos = jetGeo.getAttribute('position').array as Float32Array
    const jetCol = jetGeo.getAttribute('color').array as Float32Array
    let jv = 0
    for (let i = 0; i < GRID.vertCount; i++) {
      const o = i * 4
      const w = _rot[o + 3]!
      if (w > TORUS.POLE_CULL) continue
      stereoProject(_rot[o]!, _rot[o + 1]!, _rot[o + 2]!, w, projScale(), _p)
      const dist = Math.hypot(_p.x, _p.y, _p.z)
      const fog = brightnessOf(dist)
      if (fog < 0.02) continue
      const jet = quasarAxes[i]
      const radius = puffRadius(w) * (jet ? QUASAR_PUFF_GROW : 1)
      const colour = jet ? _quasarTint : _base
      _dummy.position.set(_p.x, _p.y, _p.z)
      _dummy.scale.setScalar(radius)
      _dummy.quaternion.copy(camera.quaternion)
      _dummy.updateMatrix()
      puffs.setMatrixAt(count, _dummy.matrix)
      tint[count * 3] = colour.r
      tint[count * 3 + 1] = colour.g
      tint[count * 3 + 2] = colour.b
      // Джет — два луча из ядра вдоль оси квазара. Свет ГАСНЕТ к концу (у конца цвет ноль,
      // а смешение аддитивное): ровная по всей длине черта читалась резкой царапиной поверх
      // пуфа. Яркость гасит тот же туман, что и пуф, и крутилка `torusTuning.jet`.
      if (jet) {
        const len = radius * QUASAR_JET_PUFFS
        const gain = fog * torusTuning.jet
        for (let sign = -1; sign <= 1; sign += 2) {
          const o3 = jv * 3
          jetPos[o3] = _p.x
          jetPos[o3 + 1] = _p.y
          jetPos[o3 + 2] = _p.z
          jetPos[o3 + 3] = _p.x + sign * jet[0] * len
          jetPos[o3 + 4] = _p.y + sign * jet[1] * len
          jetPos[o3 + 5] = _p.z + sign * jet[2] * len
          jetCol[o3] = _quasarTint.r * gain
          jetCol[o3 + 1] = _quasarTint.g * gain
          jetCol[o3 + 2] = _quasarTint.b * gain
          jetCol[o3 + 3] = 0
          jetCol[o3 + 4] = 0
          jetCol[o3 + 5] = 0
          jv += 2
        }
      }
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
    jetGeo.getAttribute('position').needsUpdate = true
    jetGeo.getAttribute('color').needsUpdate = true
    jetGeo.setDrawRange(0, jv)
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
        const slot = e * DPE + k
        const t = (k + 0.5 + _along[slot]! * 0.9) / DPE
        slerpS3(_rot, i, j, t, _s4)
        const w = _s4[3]!
        if (w > TORUS.POLE_CULL) continue
        stereoProject(_s4[0]!, _s4[1]!, _s4[2]!, w, projScale(), _p)
        const b = brightnessOf(Math.hypot(_p.x, _p.y, _p.z))
        if (b < 0.02) continue
        // Поперечный разброс задан УГЛОМ на S³ и переведён в метры тем же множителем, что и
        // пуфы: вблизи нить толще, вдали тоньше — как настоящая, а не нарисованная на экране.
        const spread = (TORUS.EDGE_JITTER * projScale()) / Math.max(1e-4, 1 - w)
        posArr[d * 3] = _p.x + _jitter[slot * 3]! * spread
        posArr[d * 3 + 1] = _p.y + _jitter[slot * 3 + 1]! * spread
        posArr[d * 3 + 2] = _p.z + _jitter[slot * 3 + 2]! * spread
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
        tickCrossPortal(crossMat, renderTime(world))
      }
    }

    // ВЫБРАННАЯ ЦЕЛЬ: своя рамка на HUD (по ней и рулишь) + направление для автопилота.
    // «Прибыл» — когда w у −1: узел пришёл в центр проекции, то есть ты внутри него.
    const targetVertex = torusTargetVertex()
    if (targetVertex === null) {
      torusTargetMarker.visible = false
      _manualPrevTarget = null
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
      // ВРУЧНУЮ тоже выходят: долетел своим ходом до выбранной (Tab) галактики — выпадаешь в
      // неё, как по автопилоту. Невыбранные узлы по-прежнему проходятся насквозь: дорога к
      // дальней цели идёт сквозь чужие галактики, и выкидывать у первой встречной нельзя.
      const inside = w < TORUS.AUTOPILOT_ARRIVE_W
      if (targetVertex !== _manualPrevTarget) _manualWasInside = inside
      else if (!torusAutopilotActive() && inside && !_manualWasInside && torusThrust() > 0) finishTorusApproach()
      _manualPrevTarget = targetVertex
      _manualWasInside = inside
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
        <lineSegments ref={jetRef} geometry={jetGeo} material={jetMat} frustumCulled={false} />
        <mesh ref={crossRef} geometry={crossGeo} material={crossMat} frustumCulled={false} visible={false} />
      </group>
    </>
  )
}
