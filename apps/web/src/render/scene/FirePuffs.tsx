import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, IcosahedronGeometry, InstancedMesh, Object3D } from 'three'
import { renderTime } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { firePuffMaterial } from '../materials/firePuff'
import { worldShrink, zoomAround } from '../worldShrink'

/**
 * КЛУБЫ ОГНЯ очагов (`world.firePuffs`): каждый рождается мелким, распухает с замедлением и
 * тает, остывая в дым. Очаг — десяток таких вокруг одной точки со сдвигом во времени, и
 * вместе они клубятся комом. Все — один InstancedMesh; возраст и зерно — цветом экземпляра.
 */

const MAX = 256
const geometry = new IcosahedronGeometry(1, 3)
const _dummy = new Object3D()
const _tint = new Color()

export function FirePuffs() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)
  const material = useMemo(firePuffMaterial, [])

  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const world = session.world
    material.uniforms.uTime!.value = clock.elapsedTime
    const shrink = worldShrink(world.player.state.scale)
    const now = renderTime(world)
    let n = 0
    if (shrink > 0) {
      for (const f of world.firePuffs) {
        if (n >= MAX) break
        const u = (now - f.born) / f.life
        // Ещё не зажёгся (рождение в будущем) или уже растаял.
        if (u < 0 || u >= 1) continue
        // Распухает быстро вначале и дотягивает к концу: 30% → 100% размера.
        const grow = 0.3 + 0.7 * (1 - (1 - u) ** 3)
        zoomAround(f.pos, f.zoomAt, shrink, _dummy.position)
        _dummy.scale.setScalar(f.size * grow * shrink)
        _dummy.updateMatrix()
        mesh.setMatrixAt(n, _dummy.matrix)
        // Жар — в синем канале: 1 обычный, больше — раскалённое ядро общего взрыва.
        mesh.setColorAt(n, _tint.setRGB(u, (f.seed % 100) / 100, (f.heat ?? 1) / 4))
        n++
      }
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, MAX]} frustumCulled={false} />
}
