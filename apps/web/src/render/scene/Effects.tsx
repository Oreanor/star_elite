import { useFrame } from '@react-three/fiber'
import { Fragment, useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LineSegments,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three'
import { findModule } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { EXPLOSION, LASER, LASER_CLASS_GLOW, LASER_CLASS_WIDTH, LASER_GLOW_FALLBACK, SHIELD_FLASH, WARP_FLASH } from '../config'
import {
  explosionMaterial,
  missileMaterial,
  podMaterial,
  shieldFlashMaterial,
  tracerMaterial,
  tractorMaterial,
  warpFlashMaterial,
} from '../materials/materials'
import { missileGeometry } from '../geometry/ships'
import { boltGeometry, podGeometry } from '../geometry/props'

/**
 * Эфемерные объекты: трассы, взрывы, контейнеры, ракеты.
 * Все буферы выделяются один раз; в кадре меняются только данные и `count`.
 */

// Лазер теперь снаряд: каждый болт сыплет по короткому следу ЗА ШАГ, а не один луч
// на выстрел. Живёт след доли секунды (GUNNERY.TRACER_LIFE), но болтов в бою десятки —
// потолок выше прежнего, чтобы в свалке следы не начали пропадать. Инстансы дешёвые.
const MAX_TRACERS = 192
const MAX_EXPLOSIONS = 48
const MAX_PODS = 48
const MAX_MISSILES = 24

/**
 * Двенадцать направлений разлёта осколков — вершины икосаэдра (золотое сечение). Фиксированный
 * набор вместо RNG: разлёт детерминирован, а разнообразие даёт сдвиг стартового индекса по
 * взрыву. Считаются один раз на модуль.
 */
const _phi = 1.6180339887
const CHUNK_DIRS = [
  [0, 1, _phi], [0, 1, -_phi], [0, -1, _phi], [0, -1, -_phi],
  [1, _phi, 0], [1, -_phi, 0], [-1, _phi, 0], [-1, -_phi, 0],
  [_phi, 0, 1], [_phi, 0, -1], [-_phi, 0, 1], [-_phi, 0, -1],
].map(([x, y, z]) => new Vector3(x, y, z).normalize())

const _expHot = /* @__PURE__ */ new Color(EXPLOSION.HOT)
const _expCool = /* @__PURE__ */ new Color(EXPLOSION.COOL)
const _expTint = /* @__PURE__ */ new Color()

const _dummy = new Object3D()
const _nose = new Vector3()
const _muzzle = new Vector3()
const _warpTint = /* @__PURE__ */ new Color()
const _shieldTint = /* @__PURE__ */ new Color()

const _dir = new Vector3()
const _mid = new Vector3()
const _zAxis = /* @__PURE__ */ new Vector3(0, 0, 1)

/**
 * Трасса — не линия, а цилиндр.
 *
 * `LineBasicMaterial.linewidth` в WebGL игнорируется: луч всегда толщиной ровно
 * в один физический пиксель, и на внутренних 320 пикселях он выглядит царапиной.
 * Поэтому болт собран из геометрии — ядро и вокруг него широкий полупрозрачный
 * ореол. Один `InstancedMesh` на цвет: сколько лазеров в бою, столько вызовов
 * отрисовки, а не столько, сколько выстрелов.
 */
function TracerBatch({
  accepts,
  color,
  radius,
  opacity,
}: {
  accepts: (weapon: string) => boolean
  color: number
  radius: number
  opacity: number
}) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    let count = 0
    for (const tracer of session.world.tracers) {
      if (count >= MAX_TRACERS || !accepts(tracer.weapon)) continue

      _dir.copy(tracer.to).sub(tracer.from)
      const length = _dir.length()
      if (length < 1e-3) continue

      _mid.copy(tracer.from).addScaledVector(_dir, 0.5)
      _dummy.position.copy(_mid)
      _dummy.quaternion.setFromUnitVectors(_zAxis, _dir.divideScalar(length))
      // Цилиндр развёрнут вдоль Z и имеет единичную длину: масштаб задаёт и то, и другое.
      _dummy.scale.set(radius, radius, length)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={ref}
      args={[boltGeometry(), tracerMaterial(color, opacity), MAX_TRACERS]}
      frustumCulled={false}
    />
  )
}

/**
 * Класс ствола по id — рендер узнаёт его из каталога модулей (домен несёт на трассе
 * лишь id). Класс 4 (если появится) читаем как 3; неизвестный id — класс 1 (голубой).
 */
const classOf = (weapon: string): 1 | 2 | 3 => {
  const cls = findModule(weapon)?.class ?? 1
  return (cls >= 3 ? 3 : cls) as 1 | 2 | 3
}

/** Три класса лазеров: у каждого свой цвет ореола и своя толщина луча. */
const LASER_CLASSES = [1, 2, 3] as const

/**
 * Ядро у всех лазеров белое, цветной только ореол. Батчей — по КЛАССУ ствола: цвет
 * (голубой/зелёный/красный) и толщина растут с классом, так что тип оружия читается в
 * бою раньше, чем долетит болт. По два инстанс-меша на класс (ореол + ядро), не по стволу.
 */
export function Tracers() {
  return (
    <>
      {LASER_CLASSES.map((cls) => {
        const width = LASER_CLASS_WIDTH[cls] ?? 1
        const glow = LASER_CLASS_GLOW[cls] ?? LASER_GLOW_FALLBACK
        const accepts = (weapon: string) => classOf(weapon) === cls
        return (
          <Fragment key={cls}>
            <TracerBatch accepts={accepts} color={glow} radius={LASER.GLOW_RADIUS * width} opacity={LASER.GLOW_OPACITY} />
            {/* Ядро поверх ореола: раскалённое добела, толщина по тому же классу. */}
            <TracerBatch accepts={accepts} color={LASER.CORE_COLOR} radius={LASER.CORE_RADIUS * width} opacity={1} />
          </Fragment>
        )
      })}
    </>
  )
}

/** Тон взрыва по возрасту: горячий бело-жёлтый → глубокий оранжевый → к чёрному (гаснет). */
function explosionTint(age: number, out: Color): Color {
  out.copy(_expHot).lerp(_expCool, age)
  // Затухание к чёрному: аддитив над космосом гаснет в ноль. Квадрат — ранний пик, резкий спад.
  return out.multiplyScalar((1 - age) * (1 - age))
}

export function Explosions() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(() => new IcosahedronGeometry(1, 0), [])
  const material = useMemo(explosionMaterial, [])
  const colors = useMemo(() => new InstancedBufferAttribute(new Float32Array(MAX_EXPLOSIONS * 3), 3), [])

  useEffect(() => {
    const mesh = ref.current
    if (mesh) mesh.instanceColor = colors
  }, [colors])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const now = session.world.time
    let count = 0

    for (const blast of session.world.explosions) {
      if (count >= MAX_EXPLOSIONS) break
      const dt = now - blast.born
      const age = dt / EXPLOSION.LIFE

      _dummy.position.copy(blast.pos)
      // Разлетается и наследует скорость того, что взорвалось.
      _dummy.position.addScaledVector(blast.vel, dt)
      _dummy.scale.setScalar(blast.scale * (1 + age * EXPLOSION.CORE_GROWTH))
      _dummy.rotation.set(age * 3, age * 2, 0)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      mesh.setColorAt(count, explosionTint(age, _expTint))
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, MAX_EXPLOSIONS]} frustumCulled={false} />
}

/**
 * Осколки взрыва: из одного события — россыпь низкополи-кусков, разлетающихся наружу,
 * кувыркаясь и гаснут. Только крупным взрывам (гибель корабля/дрона/ракеты), не искре болта —
 * так «богаче» достаётся тому, что этого стоит. Один InstancedMesh, ноль аллокаций в кадре.
 */
export function ExplosionChunks() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(() => new IcosahedronGeometry(1, 0), [])
  const material = useMemo(explosionMaterial, [])
  const colors = useMemo(() => new InstancedBufferAttribute(new Float32Array(EXPLOSION.MAX_CHUNKS * 3), 3), [])

  useEffect(() => {
    const mesh = ref.current
    if (mesh) mesh.instanceColor = colors
  }, [colors])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const now = session.world.time
    let count = 0

    for (const blast of session.world.explosions) {
      if (blast.scale < EXPLOSION.CHUNK_MIN_SCALE) continue
      const dt = now - blast.born
      const age = dt / EXPLOSION.LIFE

      const k = Math.min(EXPLOSION.CHUNK_MAX_PER, Math.round(blast.scale * EXPLOSION.CHUNK_PER_SCALE))
      // Сдвиг стартового направления по взрыву — чтобы соседние гибели не разлетались одинаково.
      const offset = (blast.born * 13) | 0
      const spread = blast.scale * EXPLOSION.CHUNK_SPREAD
      const tint = explosionTint(age, _expTint)

      for (let i = 0; i < k; i++) {
        if (count >= EXPLOSION.MAX_CHUNKS) break
        const dir = CHUNK_DIRS[(offset + i) % CHUNK_DIRS.length]!

        _dummy.position.copy(blast.pos)
        _dummy.position.addScaledVector(blast.vel, dt)
        // Летит наружу, замедляясь (ease-out), — как разлёт от вспышки.
        _dummy.position.addScaledVector(dir, spread * age * (2 - age))
        // Кусок мельче ядра и усыхает к концу.
        _dummy.scale.setScalar(blast.scale * 0.5 * (1 - age * 0.6))
        _dummy.rotation.set(age * 6 + i, age * 5 - i, i)
        _dummy.updateMatrix()
        mesh.setMatrixAt(count, _dummy.matrix)
        mesh.setColorAt(count, tint)
        count++
      }
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, EXPLOSION.MAX_CHUNKS]} frustumCulled={false} />
}

/**
 * Вспышки гиперперехода. Домен заполняет `world.warps` при прыжке НПС и сам их
 * гасит по `WARP.FLASH_LIFE`; рендер лишь рисует свечение в точке прыжка.
 *
 * Один `InstancedMesh` на все вспышки — один вызов отрисовки. Яркость и тон каждой
 * приходят инстансным цветом: материал общий, но аддитив домножает его на цвет
 * инстанса, поэтому каждая вспышка гаснет отдельно, без своего шейдера.
 *
 * Прибытие и уход различаются и цветом, и жестом: прибывший вспыхивает и
 * разлетается наружу, уходящий — схлопывается к точке прыжка.
 */
export function WarpFlashes() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(() => new IcosahedronGeometry(1, 0), [])
  const material = useMemo(warpFlashMaterial, [])
  // Буфер цветов выделяется один раз, как и меш: в кадре меняются только числа.
  const colors = useMemo(() => new InstancedBufferAttribute(new Float32Array(WARP_FLASH.MAX * 3), 3), [])

  // instanceColor рождается лишь первым setColorAt; привязываем свой буфер до кадра,
  // иначе первая вспышка мигнёт белым.
  useEffect(() => {
    const mesh = ref.current
    if (mesh) mesh.instanceColor = colors
  }, [colors])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const now = session.world.time
    let count = 0

    for (const flash of session.world.warps) {
      if (count >= WARP_FLASH.MAX) break
      const age = (now - flash.born) / WARP_FLASH.LIFE // 0..1 за время жизни
      if (age < 0 || age > 1) continue

      _dummy.position.copy(flash.pos)
      if (flash.arriving) {
        // Прибытие: короткая вспышка, затем разлёт наружу.
        _dummy.scale.setScalar(WARP_FLASH.SIZE * (0.35 + age * 1.3))
        _warpTint.set(WARP_FLASH.ARRIVE_COLOR)
      } else {
        // Уход: схлопывание к точке прыжка.
        _dummy.scale.setScalar(WARP_FLASH.SIZE * (1.35 - age * 1.2))
        _warpTint.set(WARP_FLASH.DEPART_COLOR)
      }
      _dummy.rotation.set(age * 4, age * 3, 0)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)

      // Ранний пик, резкий спад: аддитив несёт яркость в цвете инстанса.
      const glow = (1 - age) * (1 - age)
      mesh.setColorAt(count, _warpTint.multiplyScalar(glow))
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, WARP_FLASH.MAX]} frustumCulled={false} />
}

/**
 * Вспышки защитного поля станции. Домен заполняет `world.shieldFlashes` там, где о поле
 * погас снаряд, и сам гасит их по `SHIELD.FLASH_LIFE`; рендер зажигает голубой кружок в
 * точке удара. Как варп-вспышки: один `InstancedMesh`, спад яркости — в цвете инстанса.
 */
export function StationShields() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  // Плоскость с радиальным градиентом, а не диск: вспышка — кусок невидимого купола,
  // проявившийся у удара, мягкий и прозрачный к краю. Плоскость в XY нормалью +Z; ниже
  // мы разворачиваем +Z вдоль радиуса станции, и пятно ложится КАСАТЕЛЬНО к сфере поля.
  const geometry = useMemo(() => new PlaneGeometry(1, 1), [])
  const material = useMemo(shieldFlashMaterial, [])
  const colors = useMemo(() => new InstancedBufferAttribute(new Float32Array(SHIELD_FLASH.MAX * 3), 3), [])

  useEffect(() => {
    const mesh = ref.current
    if (mesh) mesh.instanceColor = colors
  }, [colors])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const now = session.world.time
    let count = 0

    for (const flash of session.world.shieldFlashes) {
      if (count >= SHIELD_FLASH.MAX) break
      const age = (now - flash.born) / SHIELD_FLASH.LIFE // 0..1 за время жизни
      if (age < 0 || age > 1) continue

      _dummy.position.copy(flash.pos)
      // Нормаль пятна — вдоль радиуса от центра станции к точке удара: плоскость
      // перпендикулярна радиусу, пятно лежит на сфере купола, а не смотрит в камеру.
      _dir.copy(flash.pos).sub(flash.center)
      const r = _dir.length()
      if (r > 1e-6) {
        _dir.divideScalar(r)
        _dummy.quaternion.setFromUnitVectors(_zAxis, _dir)
      } else {
        _dummy.quaternion.identity()
      }
      // Вспыхнул и растёкся: пятно распухает от половины радиуса и гаснет. Слабый удар —
      // пятно и мельче, и тусклее (intensity), но поле всё равно видно, что оно тут.
      _dummy.scale.setScalar(SHIELD_FLASH.SIZE * (0.6 + flash.intensity * 0.7) * (0.5 + age * 1.1))
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)

      // Ранний пик, резкий спад; и общая яркость по силе удара (intensity).
      const glow = (1 - age) * (1 - age) * flash.intensity
      _shieldTint.set(SHIELD_FLASH.COLOR)
      mesh.setColorAt(count, _shieldTint.multiplyScalar(glow))
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geometry, material, SHIELD_FLASH.MAX]} frustumCulled={false} />
}

export function CargoPods() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    let count = 0
    for (const pod of session.world.pods) {
      if (!pod.alive || count >= MAX_PODS) continue
      _dummy.position.copy(pod.pos)
      _dummy.quaternion.copy(pod.quat)
      _dummy.scale.setScalar(1)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[podGeometry(), podMaterial(), MAX_PODS]} frustumCulled={false} />
}

export function Missiles() {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    let count = 0
    for (const missile of session.world.missiles) {
      if (!missile.alive || count >= MAX_MISSILES) continue
      _dummy.position.copy(missile.pos)
      _dummy.quaternion.copy(missile.quat)
      _dummy.scale.setScalar(1)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[missileGeometry(), missileMaterial(), MAX_MISSILES]} frustumCulled={false} />
  )
}

/**
 * Тяговый луч: отрезок от носа корабля к каждому притянутому контейнеру.
 *
 * Кого тянет — решает домен и помечает `pod.tractored`. Рендер не пересчитывает
 * ни конус, ни дальность: два независимых правила однажды разойдутся, и луч
 * начнёт светить туда, где ничего не тянется.
 *
 * Буфер выделен один раз, в кадре меняются только координаты и drawRange.
 */
export function TractorBeam() {
  const session = useSession()
  const ref = useRef<LineSegments>(null)

  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(MAX_PODS * 6), 3))
    g.setDrawRange(0, 0)
    return g
  }, [])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const player = session.world.player
    const attribute = mesh.geometry.getAttribute('position') as BufferAttribute
    const array = attribute.array as Float32Array

    // Луч бьёт из носа, а не из центра корпуса.
    _nose.set(0, 0, -1).applyQuaternion(player.state.quat)
    _muzzle.copy(player.state.pos).addScaledVector(_nose, player.spec.hull.radius)

    let count = 0
    for (const pod of session.world.pods) {
      if (!pod.alive || !pod.tractored || count >= MAX_PODS) continue

      const o = count * 6
      array[o] = _muzzle.x
      array[o + 1] = _muzzle.y
      array[o + 2] = _muzzle.z
      array[o + 3] = pod.pos.x
      array[o + 4] = pod.pos.y
      array[o + 5] = pod.pos.z
      count++
    }

    mesh.geometry.setDrawRange(0, count * 2)
    attribute.needsUpdate = true
  })

  return <lineSegments ref={ref} geometry={geometry} material={tractorMaterial()} frustumCulled={false} />
}
