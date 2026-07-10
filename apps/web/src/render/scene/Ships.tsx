import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { InstancedMesh, Mesh, Object3D } from 'three'
import { isVisible } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { cobraGeometry, sidewinderGeometry } from '../geometry/ships'
import { cloakMaterial, hullMaterial } from '../materials/materials'

/** Все враги — один InstancedMesh: 1 draw call вместо N. */
const MAX_ENEMIES = 32

// Единственный объект для сборки матриц. `new Object3D()` в кадре — мусор для GC.
const _dummy = new Object3D()

export function PlayerShip() {
  const session = useSession()
  const ref = useRef<Mesh>(null)

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const player = session.world.player

    mesh.position.copy(player.state.pos)
    mesh.quaternion.copy(player.state.quat)
    // Из кабины камера внутри корпуса — меш только мешал бы.
    mesh.visible = player.alive && session.view === 'chase'

    // Свой корабль под полем видно — иначе пилот теряет собственный нос.
    // Чужой не видно вовсе, и это разные вещи: одна про интерфейс, другая про мир.
    mesh.material = player.cloaked ? cloakMaterial() : hullMaterial()
  })

  return <mesh ref={ref} geometry={cobraGeometry()} material={hullMaterial()} frustumCulled={false} />
}

export function EnemyShips() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(sidewinderGeometry, [])
  const material = useMemo(hullMaterial, [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    let count = 0
    for (const ship of session.world.ships) {
      // Замаскированный чужой не рисуется вовсе: правило видимости — из домена.
      if (!isVisible(ship) || count >= MAX_ENEMIES) continue

      _dummy.position.copy(ship.state.pos)
      _dummy.quaternion.copy(ship.state.quat)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    // count — сколько инстансов реально рисовать. Остальные не трогаем.
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, MAX_ENEMIES]}
      // Инстансы движутся каждый кадр: пересчёт общего bounding box дороже,
      // чем лишний draw call, который всё равно один.
      frustumCulled={false}
    />
  )
}
