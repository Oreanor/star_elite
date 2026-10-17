import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  ConeGeometry,
  DataTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RGBAFormat,
  Vector3,
} from 'three'
import { beamDirection, renderPos, renderTime, type BodyEntity } from '@elite/sim'
import { useSession } from '../../session/GameContext'
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

/**
 * Прозрачность вдоль длины: ярко у тела, тает к концу. У конуса `v = 1` у вершины (после
 * переворота вершина осталась с v = 1), поэтому строка текстуры v — это доля «от конца».
 */
export const beamFade = (() => {
  const n = 64
  // RGBA, а не один канал: `alphaMap` в three читает ЗЕЛЁНЫЙ — одноканальная красная
  // текстура дала бы ноль, и луч был бы невидим.
  const data = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const v = Math.round(255 * Math.pow(i / (n - 1), 1.6))
    data.set([v, v, v, 255], i * 4)
  }
  const tex = new DataTexture(data, 1, n, RGBAFormat)
  tex.needsUpdate = true
  return tex
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

function BeamPair({ body }: { body: BodyEntity }) {
  const session = useSession()
  const camera = useThree((s) => s.camera)
  const a = useRef<Mesh>(null)
  const b = useRef<Mesh>(null)
  const pulsar = body.kind === 'star'
  const materials = useMemo(
    () =>
      [0, 1].map(
        () =>
          new MeshBasicMaterial({
            color: pulsar ? PULSAR_COLOR : JET_COLOR,
            alphaMap: beamFade,
            transparent: true,
            opacity: 0.6,
            blending: AdditiveBlending,
            depthWrite: false,
            side: DoubleSide,
            toneMapped: false,
            fog: false,
          }),
      ),
    [pulsar],
  )
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])

  useFrame(() => {
    const beams = body.beams
    const ma = a.current
    const mb = b.current
    if (!beams || !ma || !mb) return
    const shrink = worldShrink(session.world.player.state.scale)
    ma.visible = mb.visible = shrink > 0
    if (shrink <= 0) return

    renderPos(session.world, body, _shown)
    beamDirection(body, renderTime(session.world), _dir)
    _toCam.copy(camera.position).sub(_shown).normalize()
    const length = beams.length * shrink
    const width = (body.radius + beams.length * Math.tan(beams.halfAngle)) * shrink

    for (const [mesh, sign, mat] of [
      [ma, 1, materials[0]!],
      [mb, -1, materials[1]!],
    ] as const) {
      mesh.position.copy(_shown)
      _q.setFromUnitVectors(_up, _signed.copy(_dir).multiplyScalar(sign))
      mesh.quaternion.copy(_q)
      mesh.scale.set(width, length, width)
      // Глядящий на камеру луч ярче: 1 — прямо на нас, AWAY_DIM — прямо от нас.
      const facing = (_toCam.dot(_dir) * sign + 1) / 2
      mat.opacity = 0.6 * (AWAY_DIM + (1 - AWAY_DIM) * facing)
    }
  })

  return (
    <>
      <mesh ref={a} geometry={beamCone} material={materials[0]} frustumCulled={false} renderOrder={3} />
      <mesh ref={b} geometry={beamCone} material={materials[1]} frustumCulled={false} renderOrder={3} />
    </>
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
