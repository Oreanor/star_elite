import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { InstancedMesh, Object3D, Quaternion, Vector3 } from 'three'
import { TITAN, renderPos, renderQuat, renderTime } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { glbGeometry, glbMaterial, placeholderGeometry } from '../geometry/ships'
import { hullMaterial } from '../materials/materials'

/**
 * Киты — корабли поколений.
 *
 * Кит — это ковчег «Атлас» (тот же `atlas.glb`, что у шасси), растянутый до города: в нём
 * живут, и рядом с ним даже ковчег-шасси обязан читаться лодкой. Процедурные болванки
 * сняты — настоящая модель читается лучше.
 *
 * Рисуются через InstancedMesh, обновляемый в кадре, а не React-обходом списка: кит
 * рождается и исчезает во время игры, а React в кадре не перерисовывается. Китов разом
 * — единицы (см. TITAN.MAX), буфер крохотный.
 */

const CAP = Math.max(1, TITAN.MAX)
/** Меш кита — корпус шасси «Атлас» из реестра GLB. */
const HULL_ID = 'atlas'
const _dummy = new Object3D()
const _spin = new Quaternion()
const AXIS_Z = new Vector3(0, 0, 1)

export function Titans() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)
  const fallbackMaterial = useMemo(hullMaterial, [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    // Модель грузится асинхронно (см. `preloadHulls`): пока её нет, кита не рисуем —
    // ромбик-заглушка размером с город хуже пустоты. Доехала — подменяем раз.
    const geometry = glbGeometry(HULL_ID)
    if (!geometry) {
      mesh.count = 0
      return
    }
    if (mesh.geometry !== geometry) {
      mesh.geometry = geometry
      mesh.material = glbMaterial(HULL_ID) ?? fallbackMaterial
    }
    // Меш уже приведён к масштабу шасси; растягиваем так, чтобы его радиус стал радиусом кита.
    const meshRadius = Math.max(geometry.boundingSphere?.radius ?? 1, 1e-3)

    let count = 0
    for (const titan of session.world.titans) {
      if (count >= CAP) break
      renderPos(session.world, titan, _dummy.position)
      // Медленное продольное вращение поверх ориентации по курсу. Угол — из времени.
      _spin.setFromAxisAngle(AXIS_Z, titan.spin * renderTime(session.world))
      renderQuat(session.world, titan, _dummy.quaternion).multiply(_spin)
      _dummy.scale.setScalar(titan.radius / meshRadius)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  // Отсечение по пирамиде выключено: матрицы инстансов three не учитывает в
  // границах, а кит-город виден с двадцати километров — рубить его нельзя.
  return <instancedMesh ref={ref} args={[placeholderGeometry(), fallbackMaterial, CAP]} frustumCulled={false} />
}
