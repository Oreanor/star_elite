import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Mesh, PlaneGeometry, Quaternion, RingGeometry, Vector3 } from 'three'
import { quasarLook, renderPos, renderTime, type BodyEntity } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { createGlowMaterial } from '../materials/starBeam'
import { createQuasarDiskMaterial, createQuasarDustMaterial, quasarPalette } from '../materials/quasarDisk'
import { worldShrink } from '../worldShrink'

/**
 * КВАЗАР целиком: огромный закрученный газовый диск, пылевая дымка вокруг и яркое ядро в
 * центре. Джеты — `StarBeams` (та же механика лучей), линза — `BlackHole`. Квазар — это дыра
 * с лучами (`body.beams`), отдельного признака нет.
 *
 * Диск в плоскости, перпендикулярной оси джетов (`spinAxis` дыры — ось её диска). Размер — в
 * горизонтах: у шарика-«Двери» и у ядра галактики пропорции одни.
 */

/** Внешний радиус газового диска, в горизонтах: от квазара к квазару в этой вилке. */
const DISK_RADII_MIN = 45
const DISK_RADII_MAX = 110
/** Дымка — до 1.6 диска (её кольцо в шейдере). */
const DUST_SCALE = 1.6
/** Яркое ядро — гауссово облако такого поперечника, в горизонтах. */
const CORE_RADII = 6

/** Кольца в плоскости XZ (нормаль +Y), радиусы в долях внешнего. Одни на модуль. */
const diskGeometry = (() => {
  const g = new RingGeometry(0.015, 1, 160, 8)
  g.rotateX(-Math.PI / 2)
  return g
})()
const dustGeometry = (() => {
  const g = new RingGeometry(0.5, DUST_SCALE, 160, 4)
  g.rotateX(-Math.PI / 2)
  return g
})()
const coreGeometry = new PlaneGeometry(2, 2)

const _shown = new Vector3()
const _axis = new Vector3()
const _up = new Vector3(0, 1, 0)
const _toCam = new Vector3()
const _q = new Quaternion()

function Quasar({ body }: { body: BodyEntity }) {
  const session = useSession()
  const camera = useThree((s) => s.camera)
  const disk = useRef<Mesh>(null)
  const dust = useRef<Mesh>(null)
  const core = useRef<Mesh>(null)
  // Свой характер у каждого квазара: размер диска и палитра — по имени (`quasarLook`).
  const look = useMemo(() => quasarLook(body.name), [body.name])
  const diskRadii = DISK_RADII_MIN + (DISK_RADII_MAX - DISK_RADII_MIN) * look.disk
  const materials = useMemo(() => {
    const palette = quasarPalette(look.palette)
    return {
      // Диск начинается у горизонта: доля внешнего радиуса ≈ 1.5 горизонта.
      disk: createQuasarDiskMaterial(1.5 / diskRadii, palette),
      dust: createQuasarDustMaterial(),
      core: createGlowMaterial(palette.core, 1.4),
    }
  }, [look, diskRadii])
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials])

  useFrame(() => {
    const world = session.world
    const shrink = worldShrink(world.player.state.scale)
    const visible = shrink > 0
    for (const m of [disk.current, dust.current, core.current]) if (m) m.visible = visible
    if (!visible || !disk.current || !dust.current || !core.current) return
    renderPos(world, body, _shown)
    const horizon = (body.visualRadius ?? body.radius) * shrink
    _axis.copy(body.spinAxis)
    if (_axis.lengthSq() < 1e-6) _axis.set(0, 1, 0)
    _q.setFromUnitVectors(_up, _axis.normalize())

    disk.current.position.copy(_shown)
    disk.current.quaternion.copy(_q)
    disk.current.scale.setScalar(horizon * diskRadii)
    dust.current.position.copy(_shown)
    dust.current.quaternion.copy(_q)
    dust.current.scale.setScalar(horizon * diskRadii)
    // Ядро — облако лицом к камере, вынесенное к ней за горизонт: в центре чёрный шар
    // горизонта (`BlackHole`) закрыл бы половину свечения, и ядро читалось бы чёрным.
    _toCam.copy(camera.position).sub(_shown)
    const toCam = _toCam.length()
    core.current.position.copy(_shown).addScaledVector(_toCam, toCam > 0 ? Math.min(horizon * 1.2, toCam * 0.5) / toCam : 0)
    core.current.quaternion.copy(camera.quaternion)
    core.current.scale.setScalar(horizon * CORE_RADII)

    const time = renderTime(world)
    materials.disk.uniforms.uTime!.value = time
    materials.dust.uniforms.uTime!.value = time
  })

  return (
    <>
      <mesh ref={dust} geometry={dustGeometry} material={materials.dust} frustumCulled={false} renderOrder={2} />
      <mesh ref={disk} geometry={diskGeometry} material={materials.disk} frustumCulled={false} renderOrder={3} />
      <mesh ref={core} geometry={coreGeometry} material={materials.core} frustumCulled={false} renderOrder={4} />
    </>
  )
}

/** Все квазары системы — дыры с джетами. Список меняется только со сменой системы. */
export function QuasarDisks() {
  const session = useSession()
  const quasars = session.world.bodies.filter((b) => b.kind === 'blackhole' && b.beams)
  if (quasars.length === 0) return null
  return (
    <>
      {quasars.map((body) => (
        <Quasar key={body.id} body={body} />
      ))}
    </>
  )
}
