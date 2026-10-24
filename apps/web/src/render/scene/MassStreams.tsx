import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, Quaternion, RingGeometry, Vector3 } from 'three'
import { renderPos, renderTime, type BodyEntity } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { createAccretionDiskMaterial, createStreamMaterial } from '../materials/massStream'
import { starWorldShrink } from '../worldShrink'

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
/** Во сколько раз лента шире видимой струи — запас под мягкий спад света к краю. */
const SOFT_WIDTH = 1.7
/** Кольцо диска в радиусах компаньона. */
const DISK_INNER = 1.25
const DISK_OUTER = 2.2

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
const _radial = new Vector3()
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
  // Прямая «гантелька» диска не имеет; у чёрной дыры свой диск (`BlackHole`).
  const straight = donor.streamStyle === 'straight'
  const ownDisk = !straight && accretor.kind !== 'blackhole'
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
    // Звёзды пары ужимаются по закону звезды — с отставанием, как их шары.
    const shrink = starWorldShrink(world.player.state.scale)
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
    // Расстояние между звёздами зум НЕ трогает: ужимаются размеры, а не места. Прежде длина
    // потока ужималась вместе с ними — хвост кончался на полпути, и компаньон «выпадал из пары».
    const d = dist
    // Всё в координатах донора. Дуга уходит с ближнего бока, загибается и входит в край диска.
    _a.copy(_u).multiplyScalar(d)
    // Почти прямо от точки донора, обращённой к компаньону, и плавный сдвиг вбок ровно на
    // радиус диска: в край диска струя входит ПО КАСАТЕЛЬНОЙ (касательная спирали там — +u).
    // Прежде контрольная точка уводила дугу на 2.6 радиуса вбок — выходил «мост».
    const gap = Math.max(rim, d - rd - rim)
    _p0.copy(_u).multiplyScalar(rd * 0.92)
    _p1.copy(_p0).addScaledVector(_u, gap * 0.45)
    _p3.copy(_a).addScaledVector(_v, rim)
    _p2.copy(_p3).addScaledVector(_u, -gap * 0.35)
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1)
      if (straight) {
        // Гантелька: от поверхности донора до поверхности компаньона по прямой.
        points[i]!.copy(_u).multiplyScalar(rd * 0.92 + (d - ra * 0.92 - rd * 0.92) * s)
      } else if (s <= ARC_SHARE) {
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
      // На витке вокруг компаньона газ расплющивает вращение: лента ложится в плоскость диска
      // (поперечник — радиус от компаньона, а не «к камере») и расползается вширь. Иначе виток
      // читался колбасой, обёрнутой вокруг звезды.
      const flat = straight ? 0 : smooth(ARC_SHARE, ARC_SHARE + 0.18, s)
      if (flat > 0) {
        _radial.copy(p).sub(_a)
        _radial.addScaledVector(_n, -_radial.dot(_n))
        const rl = _radial.length()
        if (rl > 0) _side.lerp(_radial.divideScalar(rl), flat).normalize()
      }
      // Шея у донора — широкая (звезда вытянута каплей), дальше тонкая струя.
      const neck = (1 - smooth(0, 0.1, s)) ** 2
      // Гантелька — КОНУС: узко у меньшей звезды, плавно шире к большей (донору).
      let w = straight
        ? ra * 0.12 + (rd * 0.42 - ra * 0.12) * (1 - s) ** 1.6
        : ra * 0.16 + (rd * 0.3 - ra * 0.16) * neck + rim * 0.38 * flat
      const o = i * 6
      // Лента шире видимой струи: свет гаснет к её краю в шейдере, а не обрывается на нём.
      w *= SOFT_WIDTH
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
    streamMat.uniforms.uEndFade!.value = straight ? 0.35 : 1
    // Расплющенный виток — рассеянный: та же масса на большей площади светит тусклее.
    streamMat.uniforms.uSpread!.value = straight ? 2 : ARC_SHARE
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
