import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Object3D } from 'three'
import type { ShipEntity } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { SHIELD_BUBBLE } from '../config'
import { shieldBubbleMaterial } from '../materials/materials'

/**
 * Защитные сферы кораблей. Пока цел щит, попадание вспыхивает френель-полем на силуэте:
 * видно, что удар приняло ПОЛЕ, а не корпус, — и у тебя, и у врага (и что щит убывает).
 * Щит пробит — домен перестаёт метить `lastShieldHitAt`, и сфера больше не загорается.
 *
 * Один `InstancedMesh` на все корабли — один вызов отрисовки. Домен лишь метит момент
 * удара по щиту; здесь мы зажигаем сферу и гасим её по возрасту. Ноль аллокаций в кадре.
 */

const _dummy = new Object3D()
const _tint = /* @__PURE__ */ new Color()

export function ShieldBubbles() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(() => {
    const g = new IcosahedronGeometry(1, 2)
    // Инстансный цвет храним своим атрибутом (тон × спад): выделяется один раз.
    g.setAttribute('aColor', new InstancedBufferAttribute(new Float32Array(SHIELD_BUBBLE.MAX * 3), 3))
    return g
  }, [])
  const material = useMemo(shieldBubbleMaterial, [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const world = session.world
    const now = world.time
    const aColor = geometry.getAttribute('aColor') as InstancedBufferAttribute
    const colors = aColor.array as Float32Array
    let count = 0

    const consider = (ship: ShipEntity): void => {
      if (count >= SHIELD_BUBBLE.MAX || !ship.alive) return
      const age = (now - ship.lastShieldHitAt) / SHIELD_BUBBLE.LIFE
      if (age < 0 || age > 1) return

      _dummy.position.copy(ship.state.pos)
      _dummy.quaternion.identity()
      _dummy.scale.setScalar(ship.spec.hull.radius * SHIELD_BUBBLE.RADIUS_FACTOR)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)

      // Вспыхнул и погас: яркость спадает к концу жизни.
      const glow = 1 - age
      _tint.set(SHIELD_BUBBLE.COLOR)
      colors[count * 3] = _tint.r * glow
      colors[count * 3 + 1] = _tint.g * glow
      colors[count * 3 + 2] = _tint.b * glow
      count++
    }

    consider(world.player)
    for (const ship of world.ships) consider(ship)

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    aColor.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, SHIELD_BUBBLE.MAX]} frustumCulled={false} />
}
