import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { InstancedMesh, Object3D } from 'three'
import { useSession } from '../../app/GameContext'
import { asteroidShapes } from '../geometry/rocks'
import { rockMaterial } from '../materials/materials'

/**
 * Пояс астероидов: по одному InstancedMesh на каждую из четырёх форм.
 * 260 камней рисуются четырьмя вызовами, а не двумястами шестьюдесятью.
 */

const MAX_PER_SHAPE = 200
const _dummy = new Object3D()

function ShapeBatch({ shapeIndex }: { shapeIndex: number }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(() => asteroidShapes()[shapeIndex]!, [shapeIndex])
  const material = useMemo(rockMaterial, [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    let count = 0
    for (const rock of session.world.asteroids) {
      if (rock.shape !== shapeIndex || count >= MAX_PER_SHAPE) continue

      _dummy.position.copy(rock.pos)
      _dummy.quaternion.copy(rock.quat)
      // Геометрия единичного радиуса — настоящий размер задаёт масштаб.
      _dummy.scale.setScalar(rock.radius)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, MAX_PER_SHAPE]} frustumCulled={false} />
}

export function AsteroidField() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <ShapeBatch key={i} shapeIndex={i} />
      ))}
    </>
  )
}
