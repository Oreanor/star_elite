import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { InstancedMesh, Mesh, Object3D } from 'three'
import { isDroneShip, isVisible } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { shipHidden } from '../../app/control/jumpFx'
import { auroraGeometry, droneGeometry, freighterGeometry, sidewinderGeometry } from '../geometry/ships'
import { cloakMaterial, hullMaterial } from '../materials/materials'

/** Все враги — один InstancedMesh: 1 draw call вместо N. */
const MAX_ENEMIES = 32
/** Четыре у игрока — но врагам их однажды тоже выдадут. */
const MAX_DRONES = 16
/** Грузовики редки и одиночны: горсти инстансов хватает с запасом. */
const MAX_FREIGHTERS = 8

/** Грузовик — свой корпус, а не «Сайдвиндер»: отличаем по шасси, а не по фракции. */
const isFreighter = (ship: { loadout: { chassis: { id: string } } }): boolean =>
  ship.loadout.chassis.id === 'freighter'

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
    // Из кабины камера внутри корпуса — меш только мешал бы. И корабль исчезает,
    // канув в кольцо прыжка: с этого мига его в старой системе уже нет.
    mesh.visible = player.alive && session.view === 'chase' && !shipHidden()

    // Свой корабль под полем видно — иначе пилот теряет собственный нос.
    // Чужой не видно вовсе, и это разные вещи: одна про интерфейс, другая про мир.
    mesh.material = player.cloaked ? cloakMaterial() : hullMaterial()
  })

  return <mesh ref={ref} geometry={auroraGeometry()} material={hullMaterial()} frustumCulled={false} />
}

/**
 * Беспилотники. Отдельный InstancedMesh, потому что у них своя геометрия, —
 * а не потому, что они «особенные»: для симуляции это обычные корабли.
 */
export function Drones() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(droneGeometry, [])
  const material = useMemo(hullMaterial, [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    let count = 0
    for (const ship of session.world.ships) {
      if (!isDroneShip(ship) || !isVisible(ship) || count >= MAX_DRONES) continue

      _dummy.position.copy(ship.state.pos)
      _dummy.quaternion.copy(ship.state.quat)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, MAX_DRONES]} frustumCulled={false} />
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
      // Беспилотник и грузовик — свои меши: корпус у них другой.
      if (isDroneShip(ship) || isFreighter(ship) || !isVisible(ship) || count >= MAX_ENEMIES) continue

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

/**
 * Тяжёлые грузовики. Свой InstancedMesh: у баржи другой корпус, вчетверо крупнее
 * истребителя, — в общий батч её не сунуть. Их немного, но и один draw call на класс.
 */
export function FreighterShips() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(freighterGeometry, [])
  const material = useMemo(hullMaterial, [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    let count = 0
    for (const ship of session.world.ships) {
      if (!isFreighter(ship) || !isVisible(ship) || count >= MAX_FREIGHTERS) continue

      _dummy.position.copy(ship.state.pos)
      _dummy.quaternion.copy(ship.state.quat)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, MAX_FREIGHTERS]} frustumCulled={false} />
}
