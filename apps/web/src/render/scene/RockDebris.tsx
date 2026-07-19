import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { InstancedMesh, MeshLambertMaterial, Object3D, type Material } from 'three'
import { MONOLITH } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { PALETTE } from '../config'
import { DEBRIS_CHUNK_VARIANTS, debrisChunkGeometries } from '../geometry/debrisChunks'
import { scenicRockGlbMap } from '../geometry/scenicRockGlb'
import { rockTexturedMaterial } from '../materials/materials'

/**
 * Осколки взорванных глыб двора. Это те же `pods` с `debris`, только вид — простой
 * камень с albedo родительского GLB, а не ящик. Подбор/луч — доменные, здесь лишь меш.
 */

const MAX_DEBRIS = 128
const _dummy = new Object3D()

let fallbackMat: MeshLambertMaterial | null = null
function debrisFallback(): MeshLambertMaterial {
  fallbackMat ??= new MeshLambertMaterial({ color: PALETTE.ASTEROID, flatShading: true })
  return fallbackMat
}

function DebrisBatch({ shapeIndex, meshIndex }: { shapeIndex: number; meshIndex: number }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => debrisChunkGeometries()[meshIndex]!, [meshIndex])
  const fallback = useMemo(() => debrisFallback(), [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const map = scenicRockGlbMap(shapeIndex)
    const material: Material = map ? rockTexturedMaterial(map) : fallback
    if (mesh.material !== material) mesh.material = material

    let count = 0
    for (const pod of session.world.pods) {
      if (!pod.alive || !pod.debris || count >= MAX_DEBRIS) continue
      if (pod.debris.shape !== shapeIndex) continue
      if (pod.id % DEBRIS_CHUNK_VARIANTS !== meshIndex) continue

      _dummy.position.copy(pod.pos)
      _dummy.quaternion.copy(pod.quat)
      _dummy.scale.setScalar(pod.debris.radius)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, fallback, MAX_DEBRIS]} frustumCulled={false} />
}

export function RockDebris() {
  return (
    <>
      {Array.from({ length: MONOLITH.ROCK_SHAPES }, (_, shape) =>
        Array.from({ length: DEBRIS_CHUNK_VARIANTS }, (_, mesh) => (
          <DebrisBatch key={`${shape}-${mesh}`} shapeIndex={shape} meshIndex={mesh} />
        )),
      )}
    </>
  )
}
