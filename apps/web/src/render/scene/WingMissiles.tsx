import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { InstancedMesh, Object3D, Vector3 } from 'three'
import { hardpointIndices, isMissile, shipAxes } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { missileGeometry } from '../geometry/ships'
import { missileMaterial } from '../materials/materials'

/**
 * Ракеты, висящие на пилонах игрока. Рисуются, пока пилон не пуст, — счётчик
 * боезапаса тут не нужен: пилон либо снаряжён, либо нет, и это видно на крыле.
 *
 * Один InstancedMesh на все четыре: четыре draw call ради четырёх ракет — расточительство.
 */

const MAX_PYLONS = 8

const _dummy = new Object3D()
const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _pos = new Vector3()

export function WingMissiles() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(missileGeometry, [])
  const material = useMemo(missileMaterial, [])
  // Пилоны — свойство шасси, оно не меняется в полёте.
  const pylons = useMemo(() => hardpointIndices(session.world.player.loadout, 'pylon'), [session])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const player = session.world.player
    // Из кабины крылья не видно, а мёртвый корабль ракет не носит.
    if (!player.alive || session.view !== 'chase') {
      mesh.count = 0
      return
    }

    shipAxes(player.state.quat, _fwd, _right, _up)

    let count = 0
    for (const index of pylons) {
      const mountIndex = player.spec.mounts.findIndex((m) => m.index === index)
      if (mountIndex < 0) continue

      const mount = player.spec.mounts[mountIndex]
      if (!mount || count >= MAX_PYLONS) continue
      // Только настоящие ракеты: дрон-ракеты (тот же слот, другой тип) на крыле рисует не эта
      // подвеска — иначе контейнер БПЛА висел бы боеголовкой.
      if (!isMissile(mount.weapon)) continue
      if ((player.guns[mountIndex]?.ammo ?? 0) <= 0) continue

      const [x, y, z] = mount.hardpoint.offset
      _pos
        .copy(player.state.pos)
        .addScaledVector(_right, x)
        .addScaledVector(_up, y)
        // Смещение задано в связанных осях, где +Z назад, а нос смотрит в -Z.
        .addScaledVector(_fwd, -z)

      _dummy.position.copy(_pos)
      _dummy.quaternion.copy(player.state.quat)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, MAX_PYLONS]} frustumCulled={false} />
}
