import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Mesh, Object3D, Quaternion, Vector3 } from 'three'
import { useSession } from '../../session/GameContext'
import { plasmaBeamGeometry } from '../geometry/props'
import { beamCoreMaterial, beamShellMaterial, stepBeamMaterials } from '../materials/plasmaBeam'
import { PLASMA } from '../config'

/**
 * Непрерывные лучи — «Столб» и всё, что домен положит в `world.beams`.
 *
 * Струя рисуется от ТЕКУЩЕГО дула, а не от точки, где её родили: домен несёт стрелка и
 * связанное смещение (та же уловка, что у дульных вспышек). Иначе на ходу луч отстаёт от
 * ствола — ровно та беда, что была у болтовых трасс.
 *
 * Пул мешей фиксирован и создаётся один раз; в кадре меняются только матрицы и `visible`.
 * Инстансинг не годится: у ядра и оболочки разные материалы и разные стороны отсечения,
 * а струй в кадре единицы — дешевле держать пару мешей на каждую.
 */

/** Больше и не нужно: у игрока один лучевой ствол, у встречных бортов — по одному. */
const MAX_BEAMS = 4

const _pos = new Vector3()
const _quat = new Quaternion()
const _zAxis = /* @__PURE__ */ new Vector3(0, 0, 1)
const _dir = new Vector3()
const _dummy = new Object3D()

export function PlasmaBeams() {
  const session = useSession()
  const cores = useRef<(Mesh | null)[]>([])
  const shells = useRef<(Mesh | null)[]>([])

  const geometry = useMemo(plasmaBeamGeometry, [])
  const coreMaterial = useMemo(beamCoreMaterial, [])
  const shellMaterial = useMemo(beamShellMaterial, [])

  useFrame(() => {
    const world = session.world
    stepBeamMaterials(world.time)

    let count = 0
    for (const beam of world.beams) {
      if (count >= MAX_BEAMS) break

      const ship = world.player.id === beam.shooterId
        ? world.player
        : world.ships.find((s) => s.id === beam.shooterId)
      if (!ship || !ship.alive) continue

      const core = cores.current[count]
      const shell = shells.current[count]
      if (!core || !shell) break

      const [ox, oy, oz] = beam.offset
      _pos.set(ox, oy, oz).applyQuaternion(ship.state.quat).add(ship.state.pos)
      _dir.copy(beam.dir)
      _quat.setFromUnitVectors(_zAxis, _dir)

      // Труба единичной длины растёт из дула ВПЕРЁД, поэтому центр — на середине струи.
      _dummy.position.copy(_pos).addScaledVector(_dir, beam.length * 0.5)
      _dummy.quaternion.copy(_quat)

      // Калибр ТОЧКИ множит толщину: носовая струя вдвое шире крыльевой (см. `Hardpoint.bore`).
      const radius = PLASMA.RADIUS * beam.bore * (ship === world.player ? 1 : PLASMA.BOT_SCALE)
      _dummy.scale.set(radius * PLASMA.CORE_FRACTION, radius * PLASMA.CORE_FRACTION, beam.length)
      _dummy.updateMatrix()
      core.matrix.copy(_dummy.matrix)
      core.visible = true

      _dummy.scale.set(radius, radius, beam.length)
      _dummy.updateMatrix()
      shell.matrix.copy(_dummy.matrix)
      shell.visible = true

      count++
    }

    // Лишние меши гасим: список струй пересобирается каждый шаг, и вчерашних в нём нет.
    for (let i = count; i < MAX_BEAMS; i++) {
      const core = cores.current[i]
      const shell = shells.current[i]
      if (core) core.visible = false
      if (shell) shell.visible = false
    }
  })

  return (
    <>
      {Array.from({ length: MAX_BEAMS }, (_, i) => (
        <group key={i}>
          <mesh
            ref={(m) => {
              shells.current[i] = m
            }}
            geometry={geometry}
            material={shellMaterial}
            matrixAutoUpdate={false}
            frustumCulled={false}
            visible={false}
            renderOrder={4}
          />
          <mesh
            ref={(m) => {
              cores.current[i] = m
            }}
            geometry={geometry}
            material={coreMaterial}
            matrixAutoUpdate={false}
            frustumCulled={false}
            visible={false}
            renderOrder={5}
          />
        </group>
      ))}
    </>
  )
}
