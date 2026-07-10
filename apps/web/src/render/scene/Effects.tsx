import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  LineSegments,
  Object3D,
  Vector3,
} from 'three'
import { useSession } from '../../app/GameContext'
import { LASER, LASER_GLOW, LASER_GLOW_FALLBACK } from '../config'
import { explosionMaterial, missileMaterial, podMaterial, tracerMaterial, tractorMaterial } from '../materials/materials'
import { missileGeometry } from '../geometry/ships'
import { boltGeometry, podGeometry } from '../geometry/props'

/**
 * Эфемерные объекты: трассы, взрывы, контейнеры, ракеты.
 * Все буферы выделяются один раз; в кадре меняются только данные и `count`.
 */

const MAX_TRACERS = 64
const MAX_EXPLOSIONS = 48
const MAX_PODS = 48
const MAX_MISSILES = 24

const _dummy = new Object3D()
const _nose = new Vector3()
const _muzzle = new Vector3()

const _dir = new Vector3()
const _mid = new Vector3()
const _zAxis = /* @__PURE__ */ new Vector3(0, 0, 1)

/**
 * Трасса — не линия, а цилиндр.
 *
 * `LineBasicMaterial.linewidth` в WebGL игнорируется: луч всегда толщиной ровно
 * в один физический пиксель, и на внутренних 320 пикселях он выглядит царапиной.
 * Поэтому болт собран из геометрии — ядро и вокруг него широкий полупрозрачный
 * ореол. Один `InstancedMesh` на цвет: сколько лазеров в бою, столько вызовов
 * отрисовки, а не столько, сколько выстрелов.
 */
function TracerBatch({
  accepts,
  color,
  radius,
  opacity,
}: {
  accepts: (weapon: string) => boolean
  color: number
  radius: number
  opacity: number
}) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    let count = 0
    for (const tracer of session.world.tracers) {
      if (count >= MAX_TRACERS || !accepts(tracer.weapon)) continue

      _dir.copy(tracer.to).sub(tracer.from)
      const length = _dir.length()
      if (length < 1e-3) continue

      _mid.copy(tracer.from).addScaledVector(_dir, 0.5)
      _dummy.position.copy(_mid)
      _dummy.quaternion.setFromUnitVectors(_zAxis, _dir.divideScalar(length))
      // Цилиндр развёрнут вдоль Z и имеет единичную длину: масштаб задаёт и то, и другое.
      _dummy.scale.set(radius, radius, length)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={ref}
      args={[boltGeometry(), tracerMaterial(color, opacity), MAX_TRACERS]}
      frustumCulled={false}
    />
  )
}

const glowOf = (weapon: string) => LASER_GLOW[weapon] ?? LASER_GLOW_FALLBACK

/** По батчу на каждый встречающийся цвет ореола — а не на каждый ствол. */
const GLOW_COLORS = [...new Set([...Object.values(LASER_GLOW), LASER_GLOW_FALLBACK])]

/**
 * Ядро у всех лазеров белое, цветной только ореол. Так болт читается как
 * раскалённый луч, а не как цветная палка: цвет несёт информацию о стволе,
 * яркость — о том, что это выстрел.
 */
export function Tracers() {
  return (
    <>
      {GLOW_COLORS.map((color) => (
        <TracerBatch
          key={color}
          accepts={(weapon) => glowOf(weapon) === color}
          color={color}
          radius={LASER.GLOW_RADIUS}
          opacity={LASER.GLOW_OPACITY}
        />
      ))}
      {/* Ядро рисуется поверх ореола одним батчем: цвет у него общий. */}
      <TracerBatch accepts={() => true} color={LASER.CORE_COLOR} radius={LASER.CORE_RADIUS} opacity={1} />
    </>
  )
}

export function Explosions() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(() => new IcosahedronGeometry(1, 0), [])
  const material = useMemo(explosionMaterial, [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const now = session.world.time
    let count = 0

    for (const blast of session.world.explosions) {
      if (count >= MAX_EXPLOSIONS) break
      const age = (now - blast.born) / 0.55

      _dummy.position.copy(blast.pos)
      // Разлетается и наследует скорость того, что взорвалось.
      _dummy.position.addScaledVector(blast.vel, now - blast.born)
      _dummy.scale.setScalar(blast.scale * (1 + age * 5))
      _dummy.rotation.set(age * 3, age * 2, 0)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    // Материал общий, поэтому гасим всю пачку разом: отдельная прозрачность
    // на инстанс требует своего атрибута и лишнего шейдера.
    material.opacity = count > 0 ? 0.75 : 0
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, MAX_EXPLOSIONS]} frustumCulled={false} />
}

export function CargoPods() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    let count = 0
    for (const pod of session.world.pods) {
      if (!pod.alive || count >= MAX_PODS) continue
      _dummy.position.copy(pod.pos)
      _dummy.quaternion.copy(pod.quat)
      _dummy.scale.setScalar(1)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[podGeometry(), podMaterial(), MAX_PODS]} frustumCulled={false} />
}

export function Missiles() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    let count = 0
    for (const missile of session.world.missiles) {
      if (!missile.alive || count >= MAX_MISSILES) continue
      _dummy.position.copy(missile.pos)
      _dummy.quaternion.copy(missile.quat)
      _dummy.scale.setScalar(1)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[missileGeometry(), missileMaterial(), MAX_MISSILES]} frustumCulled={false} />
  )
}

/**
 * Тяговый луч: отрезок от носа корабля к каждому притянутому контейнеру.
 *
 * Кого тянет — решает домен и помечает `pod.tractored`. Рендер не пересчитывает
 * ни конус, ни дальность: два независимых правила однажды разойдутся, и луч
 * начнёт светить туда, где ничего не тянется.
 *
 * Буфер выделен один раз, в кадре меняются только координаты и drawRange.
 */
export function TractorBeam() {
  const session = useSession()
  const ref = useRef<LineSegments>(null)

  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(MAX_PODS * 6), 3))
    g.setDrawRange(0, 0)
    return g
  }, [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const player = session.world.player
    const attribute = mesh.geometry.getAttribute('position') as BufferAttribute
    const array = attribute.array as Float32Array

    // Луч бьёт из носа, а не из центра корпуса.
    _nose.set(0, 0, -1).applyQuaternion(player.state.quat)
    _muzzle.copy(player.state.pos).addScaledVector(_nose, player.spec.hull.radius)

    let count = 0
    for (const pod of session.world.pods) {
      if (!pod.alive || !pod.tractored || count >= MAX_PODS) continue

      const o = count * 6
      array[o] = _muzzle.x
      array[o + 1] = _muzzle.y
      array[o + 2] = _muzzle.z
      array[o + 3] = pod.pos.x
      array[o + 4] = pod.pos.y
      array[o + 5] = pod.pos.z
      count++
    }

    mesh.geometry.setDrawRange(0, count * 2)
    attribute.needsUpdate = true
  })

  return <lineSegments ref={ref} geometry={geometry} material={tractorMaterial()} frustumCulled={false} />
}
