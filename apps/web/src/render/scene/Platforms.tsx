import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { InstancedMesh, Object3D, Quaternion, Vector3 } from 'three'
import { PLATFORM } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { platformGeometry } from '../geometry/platform'
import { hullMaterial } from '../materials/materials'

/**
 * Пиратские платформы-гнёзда.
 *
 * Рисуются как киты и корабли: через InstancedMesh, обновляемый прямо в кадре, а
 * не React-обходом списка. Платформа рождается и гибнет во время игры, а React в
 * кадре не перерисовывается — узнать о ней он мог бы только через setState, то
 * есть ценой частоты кадров. По одному меху на облик; их немного.
 *
 * Платформ разом — единицы (см. PLATFORM.MAX), поэтому буфер крохотный.
 */

const CAP = Math.max(1, PLATFORM.MAX)
const _dummy = new Object3D()
const _spin = new Quaternion()
const AXIS_Z = new Vector3(0, 0, 1)

function VariantBatch({ variant }: { variant: number }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => platformGeometry(variant), [variant])
  const material = useMemo(hullMaterial, [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    let count = 0
    for (const platform of session.world.platforms) {
      if (!platform.alive || platform.variant % PLATFORM.VARIANTS !== variant || count >= CAP) continue

      _dummy.position.copy(platform.pos)
      // Медленный крен поверх ориентации гнезда. Угол — из времени, не накапливаем.
      _spin.setFromAxisAngle(AXIS_Z, platform.spin * session.world.time)
      _dummy.quaternion.copy(platform.quat).multiply(_spin)
      // Масштаб — по силуэту (extent), а не по ядру столкновений (radius).
      _dummy.scale.setScalar(platform.extent)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  // Отсечение по пирамиде выключено: матрицы инстансов three в границах не учитывает,
  // а платформа-авианосец видна издалека — рубить её нельзя.
  return <instancedMesh ref={ref} args={[geometry, material, CAP]} frustumCulled={false} />
}

export function Platforms() {
  return (
    <>
      {Array.from({ length: PLATFORM.VARIANTS }, (_, i) => (
        <VariantBatch key={i} variant={i} />
      ))}
    </>
  )
}
