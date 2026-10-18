import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, Quaternion, RingGeometry, Vector3 } from 'three'
import { renderPos, renderTime, type BodyEntity } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { createAccretionDiskMaterial, createStreamMaterial } from '../materials/massStream'
import { worldShrink } from '../worldShrink'

/**
 * ПЕРЕТЕКАНИЕ ВЕЩЕСТВА в тесной паре (`BodyEntity.streamTo`): струя с ближнего бока донора
 * изгибается к компаньону и закручивается в диск вокруг него. Всё в плоскости пары.
 *
 * Струя — одна лента лицом к камере (один вызов отрисовки), её точки пересчитываются в кадре
 * в заранее выделенный буфер: пара обращается, и струя едет вместе с ней. Вершины — в
 * координатах ДОНОРА, не мира: мир на масштабе а.е., и float32 рвал бы ленту шириной в
 * километры на ступеньки. У самого донора лента широкая — звезда «вытянута» к компаньону.
 */

/** Точек на ленте. */
const N = 128
/** Доля точек на дуге «донор → край диска»; остальное — виток спирали в диск. */
const ARC_SHARE = 0.62
/** Витков спирали внутри диска. */
const SPIRAL_TURNS = 1.15
/** Кольцо диска в радиусах компаньона. */
const DISK_INNER = 1.25
const DISK_OUTER = 3.2

/** Диск — кольцо в плоскости XZ (нормаль +Y), радиусы в единицах компаньона. Один на модуль. */
const diskGeometry = (() => {
  const g = new RingGeometry(DISK_INNER, DISK_OUTER, 96, 1)
  g.rotateX(-Math.PI / 2)
  return g
})()

const _donor = new Vector3()
const _acc = new Vector3()
const _u = new Vector3()
const _v = new Vector3()
const _n = new Vector3()
const _a = new Vector3()
const _p0 = new Vector3()
const _p1 = new Vector3()
const _p2 = new Vector3()
const _p3 = new Vector3()
const _tan = new Vector3()
const _toCam = new Vector3()
const _side = new Vector3()
const _camLocal = new Vector3()
const _up = new Vector3(0, 1, 0)
const _q = new Quaternion()

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Кубическая Безье в `out`. */
function bezier(t: number, out: Vector3): Vector3 {
  const m = 1 - t
  return out
    .copy(_p0)
    .multiplyScalar(m * m * m)
    .addScaledVector(_p1, 3 * m * m * t)
    .addScaledVector(_p2, 3 * m * t * t)
    .addScaledVector(_p3, t * t * t)
}

function Stream({ donor, accretor }: { donor: BodyEntity; accretor: BodyEntity }) {
  const session = useSession()
  const camera = useThree((s) => s.camera)
  const ribbon = useRef<Mesh>(null)
  const disk = useRef<Mesh>(null)

  const { geometry, points } = useMemo(() => {
    const g = new BufferGeometry()
    const pos = new BufferAttribute(new Float32Array(N * 2 * 3), 3)
    pos.setUsage(DynamicDrawUsage)
    const uv = new Float32Array(N * 2 * 2)
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1)
      uv.set([s, -1, s, 1], i * 4)
    }
    const index: number[] = []
    for (let i = 0; i < N - 1; i++) {
      const a = 2 * i
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    g.setAttribute('position', pos)
    g.setAttribute('uv', new BufferAttribute(uv, 2))
    g.setIndex(index)
    return { geometry: g, points: Array.from({ length: N }, () => new Vector3()) }
  }, [])
  const streamMat = useMemo(() => createStreamMaterial(donor.color), [donor.color])
  const diskMat = useMemo(() => createAccretionDiskMaterial(donor.color, DISK_INNER, DISK_OUTER), [donor.color])
  // У чёрной дыры свой диск (`BlackHole`) — второй не рисуем.
  const ownDisk = accretor.kind !== 'blackhole'
  useEffect(
    () => () => {
      geometry.dispose()
      streamMat.dispose()
      diskMat.dispose()
    },
    [geometry, streamMat, diskMat],
  )

  useFrame(() => {
    const mesh = ribbon.current
    if (!mesh) return
    const world = session.world
    const shrink = worldShrink(world.player.state.scale)
    mesh.visible = shrink > 0
    if (disk.current) disk.current.visible = ownDisk && shrink > 0
    if (shrink <= 0) return

    renderPos(world, donor, _donor)
    renderPos(world, accretor, _acc)
    _u.copy(_acc).sub(_donor)
    const dist = _u.length()
    if (dist < 1) return
    _u.divideScalar(dist)
    // Плоскость пары — эклиптика (у орбит пары наклона нет): нормаль +Y.
    _n.set(0, 1, 0)
    if (Math.abs(_u.y) > 0.95) _n.set(1, 0, 0)
    _v.crossVectors(_n, _u).normalize()

    const rd = donor.radius * shrink
    const ra = accretor.radius * shrink
    const rim = ra * DISK_OUTER * 0.85
    const inner = ra * DISK_INNER * 1.05
    const d = dist * shrink
    // Всё в координатах донора. Дуга уходит с ближнего бока, загибается и входит в край диска.
    _a.copy(_u).multiplyScalar(d)
    _p0.copy(_u).multiplyScalar(rd * 0.88)
    _p1.copy(_u).multiplyScalar(rd * 1.45)
    _p2.copy(_a).addScaledVector(_u, -rim * 0.5).addScaledVector(_v, rim * 2.6)
    _p3.copy(_a).addScaledVector(_v, rim)
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1)
      if (s <= ARC_SHARE) {
        bezier(s / ARC_SHARE, points[i]!)
      } else {
        // Спираль внутрь: от края диска к внутреннему ободу, касательная — продолжение дуги.
        const t = (s - ARC_SHARE) / (1 - ARC_SHARE)
        const th = t * SPIRAL_TURNS * Math.PI * 2
        const r = rim + (inner - rim) * t
        points[i]!.copy(_a).addScaledVector(_v, r * Math.cos(th)).addScaledVector(_u, r * Math.sin(th))
      }
    }

    // Лента лицом к камере: поперечник — касательная × взгляд. Камера — в тех же координатах.
    _camLocal.copy(camera.position).sub(_donor)
    const arr = (geometry.getAttribute('position') as BufferAttribute).array as Float32Array
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1)
      const p = points[i]!
      _tan.copy(points[Math.min(N - 1, i + 1)]!).sub(points[Math.max(0, i - 1)]!)
      _toCam.copy(_camLocal).sub(p)
      _side.crossVectors(_tan, _toCam)
      const len = _side.length()
      if (len > 0) _side.divideScalar(len)
      // Шея у донора — широкая (звезда вытянута каплей), дальше тонкая струя, к диску тоньше.
      const neck = (1 - smooth(0, 0.14, s)) ** 2
      const w = (ra * 0.22 + (rd * 0.75 - ra * 0.22) * neck) * (1 - 0.4 * smooth(0.6, 1, s))
      const o = i * 6
      arr[o] = p.x - _side.x * w
      arr[o + 1] = p.y - _side.y * w
      arr[o + 2] = p.z - _side.z * w
      arr[o + 3] = p.x + _side.x * w
      arr[o + 4] = p.y + _side.y * w
      arr[o + 5] = p.z + _side.z * w
    }
    geometry.getAttribute('position').needsUpdate = true
    mesh.position.copy(_donor)

    const time = renderTime(world)
    streamMat.uniforms.uTime!.value = time
    if (disk.current && ownDisk) {
      disk.current.position.copy(_acc)
      disk.current.scale.setScalar(ra)
      _q.setFromUnitVectors(_up, _n)
      disk.current.quaternion.copy(_q)
      diskMat.uniforms.uTime!.value = time
    }
  })

  return (
    <>
      <mesh ref={ribbon} geometry={geometry} material={streamMat} frustumCulled={false} renderOrder={3} />
      {ownDisk && <mesh ref={disk} geometry={diskGeometry} material={diskMat} frustumCulled={false} renderOrder={3} />}
    </>
  )
}

/** Все пары с перетеканием в системе. Список меняется только со сменой системы. */
export function MassStreams() {
  const session = useSession()
  const bodies = session.world.bodies
  const pairs = bodies.flatMap((donor) => {
    const accretor = donor.streamTo == null ? undefined : bodies.find((b) => b.id === donor.streamTo)
    return accretor ? [{ donor, accretor }] : []
  })
  if (pairs.length === 0) return null
  return (
    <>
      {pairs.map(({ donor, accretor }) => (
        <Stream key={donor.id} donor={donor} accretor={accretor} />
      ))}
    </>
  )
}
