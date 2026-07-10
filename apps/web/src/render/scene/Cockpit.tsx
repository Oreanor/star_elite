import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Mesh } from 'three'
import { useSession } from '../../app/GameContext'
import { CAMERA } from '../config'
import { cockpitGeometry } from '../geometry/props'
import { cockpitMaterial } from '../materials/materials'

/**
 * Рамка кабины — геометрия, а не нарисованная картинка поверх.
 * Стойки честно закрывают обзор и смещаются вместе с кораблём в вираже,
 * а на быстром довороте край панели проходит перед звёздами. Спрайт так не умеет.
 */
export function Cockpit() {
  const session = useSession()
  const ref = useRef<Mesh>(null)

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const visible = session.view === 'cockpit' && session.world.player.alive
    mesh.visible = visible
    if (!visible) return

    const state = session.world.player.state
    mesh.position.copy(state.pos)
    mesh.quaternion.copy(state.quat)
    // Кабина стоит там же, где глаз пилота: иначе рамка съедет от камеры.
    mesh.translateX(CAMERA.COCKPIT_OFFSET[0])
    mesh.translateY(CAMERA.COCKPIT_OFFSET[1])
    mesh.translateZ(CAMERA.COCKPIT_OFFSET[2])
  })

  return <mesh ref={ref} geometry={cockpitGeometry()} material={cockpitMaterial()} frustumCulled={false} />
}
