import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Mesh, Quaternion } from 'three'
import type { FigurineEntity } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { statueGlbGeometry, statueGlbMaterial } from '../geometry/statueGlb'
import { worldShrink } from '../worldShrink'

/**
 * Коллекционные статуэтки на орбитах системы. Тот же GLB-реестр, что у монолитов;
 * угол = spin·time — пауза и сеть не рассинхронят.
 */

const _spin = new Quaternion()

function Figurine({ figurine }: { figurine: FigurineEntity }) {
  const ref = useRef<Mesh>(null)
  const session = useSession()

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    if (!figurine.alive) {
      mesh.visible = false
      return
    }
    const g = statueGlbGeometry(figurine.variant)
    const m = statueGlbMaterial(figurine.variant)
    const shrink = worldShrink(session.world.player.state.scale)
    mesh.visible = g !== null && shrink > 0
    if (!g || !m || shrink <= 0) return
    if (mesh.geometry !== g) mesh.geometry = g
    if (mesh.material !== m) mesh.material = m

    mesh.position.copy(figurine.pos)
    _spin.setFromAxisAngle(figurine.spinAxis, figurine.spin * session.world.time)
    mesh.quaternion.copy(_spin)
    mesh.scale.setScalar(figurine.radius * shrink)
  })

  return <mesh ref={ref} frustumCulled={false} />
}

export function Figurines() {
  const session = useSession()
  return (
    <>
      {session.world.figurines.map((f) => (
        <Figurine key={f.id} figurine={f} />
      ))}
    </>
  )
}
