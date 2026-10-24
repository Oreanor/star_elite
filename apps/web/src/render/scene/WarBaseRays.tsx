import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  InstancedMesh,
  Mesh,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type InstancedBufferAttribute,
} from 'three'
import { renderTime, type WarBaseEntity } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { WARBASE_RAYS } from '../config'
import { flashMaterial } from '../materials/cataclysm'
import { rayGeometry, rayMaterial } from '../materials/warBaseRay'
import { worldShrink } from '../worldShrink'

/**
 * СВЕТ ЯДРА базы, сносимой шаром: из центра один за другим пробивают обшивку конусы света
 * (`base.rays` — домен знает, где и когда), ядро разгорается и светит сквозь корпус, а в миг
 * общего взрыва вспыхивает бело-голубым шаром. Лучи горят до общего взрыва и гаснут с ним.
 *
 * Лучи всех баз — один InstancedMesh (конус с вершиной в центре базы); ядро — билборд на базу,
 * их единицы. В кадре — только матрицы и униформы, ни одной аллокации.
 */

const MAX_RAYS = 64
const MAX_CORES = 4
const Y = new Vector3(0, 1, 0)
const _dummy = new Object3D()
const _q = new Quaternion()

/** Ход 0 → 1 за τ: быстро вначале — прорыв, а не надувание. */
const ease = (t: number, tau: number) => 1 - Math.exp(-Math.max(0, t) / tau)

export function WarBaseRays() {
  const session = useSession()
  const rays = useRef<InstancedMesh>(null)
  const cores = useRef<(Mesh | null)[]>([])
  const geometry = useMemo(rayGeometry, [])
  const material = useMemo(rayMaterial, [])
  const plane = useMemo(() => new PlaneGeometry(2, 2), [])
  const coreMats = useMemo(
    () =>
      Array.from({ length: MAX_CORES }, () => {
        const m = flashMaterial()
        // Свет ядра — сквозь корпус: глубину не проверяем, он светит изнутри.
        m.depthTest = false
        return m
      }),
    [],
  )
  const glow = useMemo(() => new Float32Array(MAX_RAYS), [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
      plane.dispose()
      for (const m of coreMats) m.dispose()
    },
    [geometry, material, plane, coreMats],
  )

  useFrame(({ camera }) => {
    const mesh = rays.current
    if (!mesh) return
    const world = session.world
    const now = renderTime(world)
    const shrink = worldShrink(world.player.state.scale)
    const R_ = WARBASE_RAYS
    let n = 0
    let c = 0
    for (const base of world.warBases) {
      if (!base.violent || base.wreckAt === null || shrink <= 0) continue
      const final = base.wreckAt + (base.wreckSpan ?? 0)
      const R = base.radius * shrink
      // После общего взрыва лучи гаснут за доли секунды: их свет уходит во вспышку ядра.
      const after = now - final
      const out = after > 0 ? Math.max(0, 1 - after / R_.FADE) : 1
      if (out > 0) n = placeRays(base, now, R, out, mesh, n)
      if (c < MAX_CORES) placeCore(base, now, final, R, cores.current[c] ?? null, coreMats[c]!, camera.quaternion)
      c++
    }
    for (let i = c; i < MAX_CORES; i++) {
      const m = cores.current[i]
      if (m) m.visible = false
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    const attr = mesh.geometry.getAttribute('instanceGlow') as InstancedBufferAttribute | undefined
    if (attr) attr.needsUpdate = true
  })

  function placeRays(base: WarBaseEntity, now: number, R: number, out: number, mesh: InstancedMesh, n: number): number {
    const R_ = WARBASE_RAYS
    for (let k = 0; k < (base.rays?.length ?? 0); k++) {
      if (n >= MAX_RAYS) break
      const ray = base.rays![k]!
      const t = now - ray.at
      if (t < 0) continue
      // Прорыв: луч выстреливает на всю длину за доли секунды и раскрывается конусом.
      const length = R * (1 + R_.REACH * ease(t, R_.GROW_TAU))
      const width = length * Math.tan(R_.HALF_ANGLE * (0.35 + 0.65 * ease(t, R_.GROW_TAU * 2)))
      _dummy.position.copy(base.pos)
      _dummy.quaternion.copy(_q.setFromUnitVectors(Y, ray.dir))
      _dummy.scale.set(width, length, width)
      _dummy.updateMatrix()
      mesh.setMatrixAt(n, _dummy.matrix)
      // Вспышка прорыва и мерцание: свет рвётся наружу толчками, а не ровной лампой.
      const pop = 1 + R_.POP * Math.exp(-t / 0.25)
      const flicker = 0.85 + 0.15 * Math.sin(now * 23 + k * 2.7) * Math.sin(now * 9.1 + k)
      glow[n] = R_.GLOW * pop * flicker * out
      n++
    }
    return n
  }

  function placeCore(
    base: WarBaseEntity,
    now: number,
    final: number,
    R: number,
    mesh: Mesh | null,
    mat: ShaderMaterial,
    face: Quaternion,
  ): void {
    if (!mesh) return
    const R_ = WARBASE_RAYS
    const t = now - base.wreckAt!
    const span = base.wreckSpan ?? 1
    const after = now - final
    let size: number
    let alpha: number
    if (after < 0) {
      // Разгар: ядро набирает свет, к общему взрыву — всё ярче (квадрат хода).
      const p = Math.min(1, t / span)
      size = R * (R_.CORE_MIN + (R_.CORE_MAX - R_.CORE_MIN) * p)
      alpha = R_.CORE_GLOW * (0.2 + 0.8 * p * p)
    } else {
      // Общий взрыв: ядро вспыхивает бело-голубым шаром и гаснет быстрее огня.
      size = R * (R_.CORE_MAX + R_.BURST * ease(after, 0.12))
      alpha = R_.BURST_GLOW * Math.exp(-after / R_.BURST_TAU)
      if (alpha < 0.01) {
        mesh.visible = false
        return
      }
    }
    mesh.visible = true
    mesh.position.copy(base.pos)
    mesh.quaternion.copy(face)
    mesh.scale.setScalar(size)
    mat.uniforms.uColor!.value.setHex(R_.COLOR)
    mat.uniforms.uAlpha!.value = alpha
  }

  return (
    <>
      <instancedMesh ref={rays} args={[geometry, material, MAX_RAYS]} frustumCulled={false} renderOrder={2}>
        <instancedBufferAttribute attach="geometry-attributes-instanceGlow" args={[glow, 1]} />
      </instancedMesh>
      {coreMats.map((m, i) => (
        <mesh
          key={i}
          ref={(el) => {
            cores.current[i] = el
          }}
          geometry={plane}
          material={m}
          visible={false}
          frustumCulled={false}
          renderOrder={3}
        />
      ))}
    </>
  )
}
