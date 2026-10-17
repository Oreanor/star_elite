import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  ConeGeometry,
  Group,
  Mesh,
  Quaternion,
  Vector3,
} from 'three'
import { beamDirection, renderPos, renderTime, type BodyEntity } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { createStarBeamMaterial } from '../materials/starBeam'
import { worldShrink } from '../worldShrink'

/**
 * ЛУЧИ СВЕТИЛ — джеты квазара и маяк пульсара (`BodyEntity.beams`). Пара конусов из центра
 * тела, направление — `beamDirection` от ПОКАЗАННОГО времени: та же формула, по которой
 * домен жжёт корпус, поэтому видимый луч всегда там, где опасно.
 *
 * Вид — простой и в стиле игры: полупрозрачный конус с аддитивным свечением, тающий к концу
 * (градиент прозрачности вдоль длины). Луч, смотрящий на камеру, ярче встречного — грубое
 * подобие релятивистского усиления: встречный джет у квазаров и вправду тусклее.
 */

/** Конус единичной высоты: вершина в начале координат, основание радиуса 1 на +Y. */
export const beamCone = (() => {
  const g = new ConeGeometry(1, 1, 20, 1, true)
  // Исходно вершина на +0.5: переворачиваем и сдвигаем — вершина в 0, основание на +1.
  g.rotateX(Math.PI)
  g.translate(0, 0.5, 0)
  return g
})()

/** Цвет луча: джет квазара голубовато-белый, маяк пульсара — холодно-белый. */
const JET_COLOR = 0x9fd0ff
const PULSAR_COLOR = 0xe2f4ff
/** Насколько тускнеет луч, глядящий от камеры, относительно глядящего на неё. */
const AWAY_DIM = 0.35

const _dir = new Vector3()
const _signed = new Vector3()
const _toCam = new Vector3()
const _shown = new Vector3()
const _up = new Vector3(0, 1, 0)
const _q = new Quaternion()

/**
 * Слои луча: узкое плотное ЯДРО и широкий тусклый ОРЕОЛ — вместе дают размытый столб света,
 * а не твёрдый конус. Ширина — в долях опасной ширины луча (`beams.halfAngle`): ядро внутри
 * неё, ореол шире — свет рассеивается дальше, чем жжёт.
 */
const LAYERS = [
  { width: 0.45, strength: 0.55 },
  { width: 1.6, strength: 0.13 },
] as const

function BeamPair({ body }: { body: BodyEntity }) {
  const session = useSession()
  const camera = useThree((s) => s.camera)
  const group = useRef<Group>(null)
  const pulsar = body.kind === 'star'
  // Четыре меша: два луча (вдоль оси и против) × два слоя. Материал на каждый — у каждого
  // своя яркость (встречный луч тусклее).
  const materials = useMemo(
    () =>
      [1, -1].flatMap(() =>
        LAYERS.map((layer) => createStarBeamMaterial(pulsar ? PULSAR_COLOR : JET_COLOR, layer.strength, pulsar ? 0.25 : 0.6)),
      ),
    [pulsar],
  )
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])

  useFrame(() => {
    const beams = body.beams
    const g = group.current
    if (!beams || !g) return
    const shrink = worldShrink(session.world.player.state.scale)
    g.visible = shrink > 0
    if (shrink <= 0) return

    const time = renderTime(session.world)
    renderPos(session.world, body, _shown)
    beamDirection(body, time, _dir)
    _toCam.copy(camera.position).sub(_shown).normalize()
    const length = beams.length * shrink
    const width = (body.radius + beams.length * Math.tan(beams.halfAngle)) * shrink

    for (let k = 0; k < g.children.length; k++) {
      const mesh = g.children[k] as Mesh
      const sign = k < LAYERS.length ? 1 : -1
      const layer = LAYERS[k % LAYERS.length]!
      const mat = materials[k]!
      mesh.position.copy(_shown)
      _q.setFromUnitVectors(_up, _signed.copy(_dir).multiplyScalar(sign))
      mesh.quaternion.copy(_q)
      mesh.scale.set(width * layer.width, length, width * layer.width)
      // Глядящий на камеру луч ярче: 1 — прямо на нас, AWAY_DIM — прямо от нас.
      const facing = (_toCam.dot(_dir) * sign + 1) / 2
      mat.uniforms.uStrength!.value = layer.strength * (AWAY_DIM + (1 - AWAY_DIM) * facing)
      mat.uniforms.uTime!.value = time
    }
  })

  return (
    <group ref={group}>
      {materials.map((m, k) => (
        <mesh key={k} geometry={beamCone} material={m} frustumCulled={false} renderOrder={3} />
      ))}
    </group>
  )
}

/** Все тела системы с лучами. Список меняется только со сменой системы — как у `BlackHole`. */
export function StarBeams() {
  const session = useSession()
  const bodies = session.world.bodies.filter((b) => b.beams)
  if (bodies.length === 0) return null
  return (
    <>
      {bodies.map((body) => (
        <BeamPair key={body.id} body={body} />
      ))}
    </>
  )
}
