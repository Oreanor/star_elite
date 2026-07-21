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
import { stepTorusFlight, torusView } from '../../app/control/torusFlight'
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
 * ДОМ-маркер: мировая позиция креста на домашней галактике, для локатора HUD. Слой считает её
 * каждый кадр, радар читает — так метка «дом» появляется на локаторе. `visible=false`, когда
 * дом ушёл за полюс проекции (не виден).
 */
export const torusHomeMarker = { x: 0, y: 0, z: 0, visible: false }

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

const GRID = buildHypertorusGrid(TORUS.NXI, TORUS.NTHETA, TORUS.NPHI)
const DPE = TORUS.DOTS_PER_EDGE
const MAX_DOTS = GRID.edgeCount * DPE

const _dummy = new Object3D()
const _base = new Color(TORUS.PUFF_COLOR)
const _p = { x: 0, y: 0, z: 0, depth: 0 }
const _rot = new Float64Array(GRID.vertCount * 4)
const _s4 = new Float64Array(4)

/** Яркость по глубине S³ — дальняя половина (у полюса/антипода) тонет во тьму. */
function brightnessOf(dist: number, depth: number): number {
  const far = 1 - smoothstep(TORUS.FOG_NEAR_M, TORUS.FOG_FAR_M, dist)
  const antipode = 1 - smoothstep(TORUS.ANTIPODE_NEAR, TORUS.ANTIPODE_FAR, depth)
  return far * antipode
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

    // ПУФЫ-галактики в узлах.
    const tintAttr = puffGeo.getAttribute('aTint') as InstancedBufferAttribute
    const fogAttr = puffGeo.getAttribute('aFog') as InstancedBufferAttribute
    const tint = tintAttr.array as Float32Array
    const fogArr = fogAttr.array as Float32Array
    let count = 0
    for (let i = 0; i < GRID.vertCount; i++) {
      const o = i * 4
      const w = _rot[o + 3]!
      if (w > TORUS.POLE_CULL) continue
      stereoProject(_rot[o]!, _rot[o + 1]!, _rot[o + 2]!, w, TORUS.SCALE, _p)
      const dist = Math.hypot(_p.x, _p.y, _p.z)
      const fog = brightnessOf(dist, _p.depth)
      if (fog < 0.02) continue
      _dummy.position.set(_p.x, _p.y, _p.z)
      _dummy.scale.setScalar(Math.max(TORUS.PUFF_MIN_R_M, TORUS.PUFF_RADIUS_M * fog))
      _dummy.quaternion.copy(camera.quaternion)
      _dummy.updateMatrix()
      puffs.setMatrixAt(count, _dummy.matrix)
      tint[count * 3] = _base.r
      tint[count * 3 + 1] = _base.g
      tint[count * 3 + 2] = _base.b
      fogArr[count] = fog
      count++
    }
    puffs.count = count
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
        stereoProject(_s4[0]!, _s4[1]!, _s4[2]!, w, TORUS.SCALE, _p)
        const dist = Math.hypot(_p.x, _p.y, _p.z)
        const b = brightnessOf(dist, _p.depth)
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

    // КРЕСТ на ДОМАШНЕЙ галактике — якорь ориентации. Едет вместе с решёткой: по нему видно,
    // где дом и куда возвращаться. Ушёл за полюс — прячем и снимаем метку локатора.
    const cross = crossRef.current
    if (cross) {
      const ho = TORUS.HOME_NODE * 4
      const hw = _rot[ho + 3]!
      if (hw > TORUS.POLE_CULL) {
        cross.visible = false
        torusHomeMarker.visible = false
      } else {
        stereoProject(_rot[ho]!, _rot[ho + 1]!, _rot[ho + 2]!, hw, TORUS.SCALE, _p)
        const fog = brightnessOf(Math.hypot(_p.x, _p.y, _p.z), _p.depth)
        cross.visible = true
        cross.position.set(_p.x, _p.y, _p.z)
        cross.scale.setScalar(Math.max(TORUS.PUFF_MIN_R_M, TORUS.PUFF_RADIUS_M * fog) * TORUS.CROSS_SCALE)
        cross.quaternion.copy(camera.quaternion)
        tickCrossPortal(crossMat, world.time)
        // Мировая позиция для локатора: локаль группы + смещение группы (она на корабле).
        torusHomeMarker.x = _p.x + group.position.x
        torusHomeMarker.y = _p.y + group.position.y
        torusHomeMarker.z = _p.z + group.position.z
        torusHomeMarker.visible = true
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
