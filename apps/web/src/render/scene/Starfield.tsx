import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Points } from 'three'
import { makeRng } from '@elite/sim'
import { STARFIELD } from '../config'
import { starfieldMaterial } from '../materials/materials'

/**
 * Дальние звёзды. Сфера точек, которая СЛЕДУЕТ ЗА КАМЕРОЙ — поэтому к ним
 * нельзя приблизиться, а при повороте носа они честно уходят вбок.
 * Это и есть «бесконечно далеко», без бесконечных координат.
 */
export function Starfield() {
  const ref = useRef<Points>(null)
  const camera = useThree((state) => state.camera)

  const geometry = useMemo(() => {
    const rng = makeRng(0x2b1e57)
    const positions = new Float32Array(STARFIELD.COUNT * 3)

    for (let i = 0; i < STARFIELD.COUNT; i++) {
      // Равномерно по сфере: наивный (θ, φ) сгустил бы звёзды у полюсов.
      const u = rng() * 2 - 1
      const angle = rng() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)

      positions[i * 3] = Math.cos(angle) * r * STARFIELD.RADIUS
      positions[i * 3 + 1] = u * STARFIELD.RADIUS
      positions[i * 3 + 2] = Math.sin(angle) * r * STARFIELD.RADIUS
    }

    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    return g
  }, [])

  useFrame(() => {
    ref.current?.position.copy(camera.position)
  })

  return (
    <points
      ref={ref}
      geometry={geometry}
      material={starfieldMaterial(STARFIELD.SIZE)}
      frustumCulled={false}
      renderOrder={-1}
    />
  )
}
