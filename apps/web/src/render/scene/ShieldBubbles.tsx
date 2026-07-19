import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, InstancedBufferAttribute, InstancedMesh, Object3D, PlaneGeometry, Quaternion } from 'three'
import type { ShipEntity } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { SHIELD_BUBBLE } from '../config'
import { shieldBubbleMaterial } from '../materials/materials'

/**
 * Защитное поле кораблей. Попадание по щиту вспыхивает голубым КРУЖКОМ, окружающим
 * корабль, — и у игрока, и у врага (и что щит убывает). Щит пробит — домен перестаёт
 * метить `lastShieldHitAt`, и кружок больше не загорается.
 *
 * Кружок плоский и развёрнут к камере (billboard): со всех сторон он одинаковая
 * окружность, а не гранёная 3D-сфера, что вблизи выглядела многоугольником. Один
 * `InstancedMesh` на все корабли — один вызов отрисовки; спад яркости — в цвете инстанса.
 */

const _dummy = new Object3D()
const _tint = /* @__PURE__ */ new Color()
const _cameraQuat = /* @__PURE__ */ new Quaternion()

export function ShieldBubbles() {
  const session = useSession()
  const camera = useThree((state) => state.camera)
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(() => new PlaneGeometry(1, 1), [])
  const material = useMemo(shieldBubbleMaterial, [])
  // Цвет каждого кружка (тон × спад) — инстансным атрибутом: гаснут по отдельности.
  const colors = useMemo(() => new InstancedBufferAttribute(new Float32Array(SHIELD_BUBBLE.MAX * 3), 3), [])

  useEffect(() => {
    const mesh = ref.current
    if (mesh) mesh.instanceColor = colors
  }, [colors])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const world = session.world
    const now = world.time
    // FlightCamera работает на -50, поэтому здесь уже лежит окончательная поза этого
    // кадра. Мировой кватернион нужен и на случай, если камеру позже посадят в rig.
    camera.getWorldQuaternion(_cameraQuat)
    let count = 0

    const consider = (ship: ShipEntity): void => {
      if (count >= SHIELD_BUBBLE.MAX || !ship.alive) return
      const age = (now - ship.lastShieldHitAt) / SHIELD_BUBBLE.LIFE
      if (age < 0 || age > 1) return

      _dummy.position.copy(ship.state.pos)
      // Billboard: кружок смотрит в камеру всегда, оттого читается одинаковой окружностью
      // под любым ракурсом. Плоскость единичная (радиус 0.5), поэтому масштаб — ДИАМЕТР:
      // берём радиус корпуса ×2 ×коэффициент, чтобы кольцо охватывало корабль.
      _dummy.quaternion.copy(_cameraQuat)
      _dummy.scale.setScalar(ship.spec.hull.radius * ship.state.scale * SHIELD_BUBBLE.RADIUS_FACTOR * 2)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)

      // Вспыхнул и погас: яркость спадает к концу жизни.
      const glow = 1 - age
      _tint.set(SHIELD_BUBBLE.COLOR).multiplyScalar(glow)
      mesh.setColorAt(count, _tint)
      count++
    }

    consider(world.player)
    for (const ship of world.ships) consider(ship)

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, SHIELD_BUBBLE.MAX]} frustumCulled={false} />
}
