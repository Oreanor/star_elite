import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import type { BodyEntity } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { STATION_RIM_RADIUS, STATION_VARIANTS, stationGeometry } from '../geometry/props'
import { stationMaterial } from '../materials/materials'

/**
 * Витрина вариантов станции — временный стенд для выбора рисунка кориолиса.
 *
 * Все четыре варианта стоят В РЯД рядом с настоящей станцией, вращаются тем же ходом
 * и мигают маяками по ободу, чтобы их можно было сравнить в одном кадре. Различаются
 * числом и формой спиц (как литые диски) и числом маяков (4–8). Порядок слева направо —
 * индексы 0..3. Когда вариант выбран, стенд снимается, а `stationGeometry(n)` остаётся.
 */

const VARIANTS = STATION_VARIANTS.length

// Маяк — светящаяся точка; аддитивная, глубину не пишет, чтобы не мерцала на ободе.
const beaconGeometry = /* @__PURE__ */ new SphereGeometry(0.045, 6, 4)
const beaconMaterial = /* @__PURE__ */ new MeshBasicMaterial({
  color: 0xffffff,
  blending: AdditiveBlending,
  transparent: true,
  depthWrite: false,
})
const BEACON_COLOR = 0x9fe0ff

const _dummy = /* @__PURE__ */ new Object3D()
const _tint = /* @__PURE__ */ new Color()
const _spin = /* @__PURE__ */ new Quaternion()
const _tilt = /* @__PURE__ */ new Quaternion()
const REST_BARREL = /* @__PURE__ */ new Vector3(0, 0, 1)

/** Один вариант: колесо + мигающие маяки, в общей группе (её и вращаем, и сдвигаем в ряд). */
function VariantWheel({ station, index }: { station: BodyEntity; index: number }) {
  const session = useSession()
  const groupRef = useRef<Group>(null)
  const lightsRef = useRef<InstancedMesh>(null)

  const variant = STATION_VARIANTS[index]!
  const geometry = useMemo(() => stationGeometry(index), [index])
  const material = useMemo(stationMaterial, [])
  const colors = useMemo(
    () => new InstancedBufferAttribute(new Float32Array(variant.lights * 3), 3),
    [variant.lights],
  )

  // Позиции маяков по ободу неподвижны в осях колеса — ставим их ОДИН раз. Мигает
  // только цвет каждый кадр. Размер маяка задан в тех же единицах, что и геометрия.
  useEffect(() => {
    const mesh = lightsRef.current
    if (!mesh) return
    mesh.instanceColor = colors
    for (let k = 0; k < variant.lights; k++) {
      const a = (k / variant.lights) * Math.PI * 2
      _dummy.position.set(Math.cos(a) * STATION_RIM_RADIUS, Math.sin(a) * STATION_RIM_RADIUS, 0)
      _dummy.scale.setScalar(1)
      _dummy.updateMatrix()
      mesh.setMatrixAt(k, _dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [colors, variant.lights])

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const time = session.world.time

    // Тот же поворот, что у настоящей станции: полюс геометрии (ствол, Z) кладём на ось
    // вращения тела, затем крутим вокруг неё углом от времени — ход совпадает с оригиналом.
    _tilt.setFromUnitVectors(REST_BARREL, station.spinAxis)
    _spin.setFromAxisAngle(station.spinAxis, station.spin * time)
    group.quaternion.copy(_spin).multiply(_tilt)

    // Ряд вдоль мировой оси X, приподнят над станцией по Y, чтобы не перекрыть её диск.
    const spacing = station.radius * 3.2
    group.position.copy(station.pos)
    group.position.x += (index - (VARIANTS - 1) / 2) * spacing
    group.position.y += station.radius * 4

    // Медленное мигание: маяки бегут по кругу фазой — «живая» станция, не болванка.
    const lights = lightsRef.current
    if (lights?.instanceColor) {
      for (let k = 0; k < variant.lights; k++) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 1.1 + (k / variant.lights) * Math.PI * 2)
        _tint.set(BEACON_COLOR).multiplyScalar(0.18 + 0.82 * pulse)
        lights.setColorAt(k, _tint)
      }
      lights.instanceColor.needsUpdate = true
    }
  })

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry} material={material} scale={station.radius} frustumCulled={false} />
      <instancedMesh
        ref={lightsRef}
        args={[beaconGeometry, beaconMaterial, variant.lights]}
        scale={station.radius}
        frustumCulled={false}
      />
    </group>
  )
}

export function StationCompare() {
  const session = useSession()
  const station = session.world.bodies.find((b) => b.kind === 'station')
  if (!station) return null

  return (
    <>
      {STATION_VARIANTS.map((_, i) => (
        <VariantWheel key={i} station={station} index={i} />
      ))}
    </>
  )
}
