import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Euler, InstancedMesh, Mesh, Object3D, Quaternion, Vector3 } from 'three'
import { WARBASE, type WarBaseEntity } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { WARBASE_FX } from '../config'
import {
  DETAIL_KEYS,
  warBaseDetailGeometry,
  warBaseDetailMaterial,
  warBaseHullGeometry,
  warBaseHullMaterial,
  type DetailKey,
} from '../geometry/warBaseGlb'
import { worldShrink } from '../worldShrink'

/**
 * Военные базы на снос: корпус-сфера + навесные детали (башня на полюсе, пушки/глаза
 * вразброс). Корпусов единицы — обычные меши; детали ОДНОГО облика идут одним
 * InstancedMesh на все базы, чтобы полсотни пушек не стоили полсотни draw call.
 *
 * Расстановка деталей ДЕТЕРМИНИРОВАНА от сида базы (домен его и хранит): у всех игроков
 * база выглядит одинаково, а поток случайности домена мы не трогаем.
 */

const MAX_DETAILS = 128
const _dummy = new Object3D()
const _spin = new Quaternion()
const _pos = new Vector3()
const _dir = new Vector3()
const _preQuat = new Quaternion()
const _align = new Quaternion()
const _UP = new Vector3(0, 1, 0)

/** Одна навесная деталь в ЛОКАЛЬНОМ кадре базы (до спина и floating-origin). */
interface Fixture {
  base: WarBaseEntity
  key: DetailKey
  /** Радиальное направление от центра базы (единичное). */
  dir: Vector3
  /** Габарит детали, м. */
  size: number
  /** Доворот облика вокруг радиали (пушки не строем). */
  roll: number
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Разложить детали по КАЖДОЙ базе: башня на полюсе, прочие — равномерно по сфере. */
function layoutFixtures(bases: readonly WarBaseEntity[]): Fixture[] {
  const out: Fixture[] = []
  const scatter: DetailKey[] = DETAIL_KEYS.filter((k) => k !== 'tower')
  for (const base of bases) {
    const rng = mulberry32(base.seed)
    const n = WARBASE.FIXTURES_MIN + Math.floor(rng() * (WARBASE.FIXTURES_MAX - WARBASE.FIXTURES_MIN + 1))

    // Башня — на «северном» полюсе (ось спина базы).
    out.push({ base, key: 'tower', dir: base.spinAxis.clone().normalize(), size: base.radius * WARBASE.TOWER_SIZE, roll: rng() * Math.PI * 2 })

    // Остальные — спираль Фибоначчи (равномерно по сфере), тип и калибр из сида.
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < n - 1; i++) {
      const t = (i + 0.5) / (n - 1)
      const y = 1 - 2 * t // от +1 к −1
      const r = Math.sqrt(Math.max(0, 1 - y * y))
      const phi = i * golden + rng() * 0.6
      const dir = new Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r).normalize()
      const key = scatter[Math.floor(rng() * scatter.length)]!
      const size = base.radius * (WARBASE.FIXTURE_SIZE_MIN + rng() * (WARBASE.FIXTURE_SIZE_MAX - WARBASE.FIXTURE_SIZE_MIN))
      out.push({ base, key, dir, size, roll: rng() * Math.PI * 2 })
    }
  }
  return out
}

/** Корпус одной базы — обычный меш (их единицы, инстансинг не нужен). */
function Hull({ base }: { base: WarBaseEntity }) {
  const session = useSession()
  const ref = useRef<Mesh>(null)
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const g = warBaseHullGeometry(base.shape)
    const m = warBaseHullMaterial(base.shape)
    const shrink = worldShrink(session.world.player.state.scale)
    if (!g || !m || shrink <= 0 || !base.alive) {
      mesh.visible = false
      return
    }
    mesh.visible = true
    if (mesh.geometry !== g) mesh.geometry = g
    if (mesh.material !== m) mesh.material = m
    mesh.position.copy(base.pos)
    mesh.quaternion.setFromAxisAngle(base.spinAxis, base.spin * session.world.time)
    mesh.scale.setScalar(base.radius * shrink)
  })
  return <mesh ref={ref} frustumCulled={false} />
}

/** Все детали одного облика — один InstancedMesh на все базы. */
function DetailBatch({ dkey, fixtures }: { dkey: DetailKey; fixtures: Fixture[] }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)
  const mine = useMemo(() => fixtures.filter((f) => f.key === dkey), [fixtures, dkey])
  const pre = useMemo(() => {
    const e = WARBASE_FX.PRE[dkey] ?? [0, 0, 0]
    return new Quaternion().setFromEuler(new Euler(e[0], e[1], e[2]))
  }, [dkey])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const g = warBaseDetailGeometry(dkey)
    const m = warBaseDetailMaterial(dkey)
    const shrink = worldShrink(session.world.player.state.scale)
    if (!g || !m || shrink <= 0) {
      mesh.count = 0
      return
    }
    if (mesh.geometry !== g) mesh.geometry = g
    if (mesh.material !== m) mesh.material = m

    const time = session.world.time
    let count = 0
    for (const f of mine) {
      if (!f.base.alive || count >= MAX_DETAILS) continue
      // Спин базы вращает и её навеску: направление и ориентацию гоним через него.
      _spin.setFromAxisAngle(f.base.spinAxis, f.base.spin * time)
      _dir.copy(f.dir).applyQuaternion(_spin)
      // Центр детали чуть выступает над поверхностью (SIT_OUT её габарита).
      const out = f.base.radius + f.size * WARBASE_FX.SIT_OUT
      _pos.copy(f.base.pos).addScaledVector(_dir, out * shrink)
      _dummy.position.copy(_pos)
      // Ориентация: локальный доворот облика → «вверх» детали на радиаль → крен по roll.
      _align.setFromUnitVectors(_UP, _dir)
      _preQuat.setFromAxisAngle(_dir, f.roll).multiply(_align).multiply(pre)
      _dummy.quaternion.copy(_preQuat)
      _dummy.scale.setScalar(f.size * shrink)
      _dummy.updateMatrix()
      mesh.setMatrixAt(count, _dummy.matrix)
      count++
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[undefined, undefined, MAX_DETAILS]} frustumCulled={false} />
}

export function WarBases() {
  const session = useSession()
  const bases = session.world.warBases
  // Расстановка стабильна в пределах системы: пересобираем только когда состав баз сменился.
  const sig = bases.map((b) => `${b.id}:${b.seed}`).join('|')
  const fixtures = useMemo(() => layoutFixtures(bases), [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {bases.map((b) => (
        <Hull key={b.id} base={b} />
      ))}
      {DETAIL_KEYS.map((k) => (
        <DetailBatch key={k} dkey={k} fixtures={fixtures} />
      ))}
    </>
  )
}
