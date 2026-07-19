import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { InstancedMesh, Object3D, Quaternion } from 'three'
import { MONOLITH } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { scenicRockGlbGeometry, scenicRockGlbMaterial } from '../geometry/scenicRockGlb'
import { worldShrink } from '../worldShrink'

/**
 * Пояс декоративных глыб у Люцифера. Один InstancedMesh на облик — десятки камней
 * без десятков draw call. Угол как у статуй: `spin·time`, без шага симуляции.
 */

const MAX_PER_SHAPE = MONOLITH.ROCK_COUNT
const _dummy = new Object3D()
const _spin = new Quaternion()

function ShapeBatch({ shapeIndex }: { shapeIndex: number }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const g = scenicRockGlbGeometry(shapeIndex)
    const m = scenicRockGlbMaterial(shapeIndex)
    if (!g || !m) {
      mesh.count = 0
      return
    }
    if (mesh.geometry !== g) mesh.geometry = g
    if (mesh.material !== m) mesh.material = m

    const shrink = worldShrink(session.world.player.state.scale)
    if (shrink <= 0) {
      mesh.count = 0
      return
    }
    let count = 0
    const time = session.world.time
    for (const rock of session.world.scenicRocks) {
      if (!rock.alive || rock.shape !== shapeIndex || count >= MAX_PER_SHAPE) continue
      _dummy.position.copy(rock.pos)
      _spin.setFromAxisAngle(rock.spinAxis, rock.spin * time)
      _dummy.quaternion.copy(_spin)
      _dummy.scale.setScalar(rock.radius * shrink)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[undefined, undefined, MAX_PER_SHAPE]} frustumCulled={false} />
}

export function ScenicRocks() {
  return (
    <>
      {Array.from({ length: MONOLITH.ROCK_SHAPES }, (_, i) => (
        <ShapeBatch key={i} shapeIndex={i} />
      ))}
    </>
  )
}
