import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { InstancedMesh, Object3D, type Texture } from 'three'
import { ASTEROID } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { asteroidShapes } from '../geometry/rocks'
import { rockMaterial, rockTexturedMaterial } from '../materials/materials'
import { loadRockTexture } from '../materials/rockTextures'
import { worldShrink } from '../worldShrink'

/**
 * Пояс астероидов: по одному InstancedMesh на каждую форму.
 * Сотни камней рисуются пятью вызовами, а не сотнями.
 *
 * Запас на форму взят не на глаз: расколотый камень рождает до SPLIT_MAX
 * осколков, и за долгий бой пояс распухает в разы против начальных 260.
 */

const MAX_PER_SHAPE = 320
const _dummy = new Object3D()

function ShapeBatch({ shapeIndex }: { shapeIndex: number }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(() => asteroidShapes()[shapeIndex]!, [shapeIndex])

  // Единственный setState за всю жизнь партии — в момент загрузки картинки.
  // В кадре React не участвует: матрицы пишутся прямо в буфер инстансов.
  const [map, setMap] = useState<Texture | null>(null)
  useEffect(() => loadRockTexture(shapeIndex, setMap), [shapeIndex])

  const material = map ? rockTexturedMaterial(map) : rockMaterial()

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    // С галактикой пояс исчезает вместе с планетами (worldShrink → 0).
    const shrink = worldShrink(session.world.player.state.scale)
    if (shrink <= 0) {
      mesh.count = 0
      return
    }

    let count = 0
    for (const rock of session.world.asteroids) {
      if (rock.shape !== shapeIndex || count >= MAX_PER_SHAPE) continue

      _dummy.position.copy(rock.pos)
      _dummy.quaternion.copy(rock.quat)
      // Геометрия единичного радиуса — настоящий размер задаёт масштаб.
      _dummy.scale.setScalar(rock.radius * shrink)
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
      {Array.from({ length: ASTEROID.SHAPES }, (_, i) => (
        <ShapeBatch key={i} shapeIndex={i} />
      ))}
    </>
  )
}
