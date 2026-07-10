import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { InstancedMesh, Object3D, Quaternion, Vector3 } from 'three'
import { TITAN } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { titanGeometry } from '../geometry/titans'
import { hullMaterial } from '../materials/materials'

/**
 * Киты — корабли поколений.
 *
 * Рисуются как корабли и астероиды: через InstancedMesh, обновляемый в кадре, а
 * не React-обходом списка. Кит рождается и исчезает во время игры, а React в
 * кадре не перерисовывается — узнать о новом ките он мог бы только через setState,
 * то есть ценой частоты кадров. По одному меху на облик: их немного.
 *
 * Китов разом — единицы (см. TITAN.MAX), поэтому буфер на облик крохотный.
 */

const CAP = Math.max(1, TITAN.MAX)
const _dummy = new Object3D()
const _spin = new Quaternion()
const AXIS_Z = new Vector3(0, 0, 1)

function VariantBatch({ variant }: { variant: number }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => titanGeometry(variant), [variant])
  const material = useMemo(hullMaterial, [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    let count = 0
    for (const titan of session.world.titans) {
      if (titan.variant % TITAN.VARIANTS !== variant || count >= CAP) continue

      _dummy.position.copy(titan.pos)
      // Медленное продольное вращение поверх ориентации по курсу. Угол — из времени.
      _spin.setFromAxisAngle(AXIS_Z, titan.spin * session.world.time)
      _dummy.quaternion.copy(titan.quat).multiply(_spin)
      _dummy.scale.setScalar(titan.radius)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  // Отсечение по пирамиде выключено: матрицы инстансов three не учитывает в
  // границах, а кит-город виден с двадцати километров — рубить его нельзя.
  return <instancedMesh ref={ref} args={[geometry, material, CAP]} frustumCulled={false} />
}

export function Titans() {
  return (
    <>
      {Array.from({ length: TITAN.VARIANTS }, (_, i) => (
        <VariantBatch key={i} variant={i} />
      ))}
    </>
  )
}
