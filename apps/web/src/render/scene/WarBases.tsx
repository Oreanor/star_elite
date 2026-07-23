import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Euler, InstancedMesh, Mesh, Object3D, Quaternion, Vector3 } from 'three'
import { warBaseFixtureWorldPos, type WarBaseEntity } from '@elite/sim'
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
 * вразброс). Расстановку и снос деталей знает ДОМЕН (`base.fixtures`) — рендер лишь рисует
 * то, что живо, и в той же точке, куда бьёт луч (`warBaseFixtureWorldPos`).
 *
 * Корпусов единицы — обычные меши; детали одного облика — один InstancedMesh на все базы.
 */

const MAX_DETAILS = 256
const _dummy = new Object3D()
const _pos = new Vector3()
const _dir = new Vector3()
const _align = new Quaternion()
const _roll = new Quaternion()
const _UP = new Vector3(0, 1, 0)

/** Облик детали по её `model`: 0 — башня, дальше — пушки/глаза/ангар. Данные, не ветка. */
const FIXTURE_MODELS: readonly DetailKey[] = ['tower', 'gun1', 'gun2', 'eye1', 'pod']
const keyOf = (model: number): DetailKey => FIXTURE_MODELS[model % FIXTURE_MODELS.length]!

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

/** Все ЖИВЫЕ детали одного облика со всех баз — один InstancedMesh. */
function DetailBatch({ dkey }: { dkey: DetailKey }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)
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
    for (const base of session.world.warBases) {
      if (!base.alive) continue
      for (const fix of base.fixtures) {
        if (!fix.alive || keyOf(fix.model) !== dkey || count >= MAX_DETAILS) continue
        // Точка ровно та же, что видит луч, — иначе стрелял бы мимо нарисованного.
        warBaseFixtureWorldPos(base, fix, time, _pos)
        _dummy.position.copy(_pos).sub(base.pos).multiplyScalar(shrink).add(base.pos)
        // Ориентация: доворот облика → «вверх» детали на радиаль → крен по roll.
        _dir.copy(_pos).sub(base.pos).normalize()
        _align.setFromUnitVectors(_UP, _dir)
        _roll.setFromAxisAngle(_dir, fix.roll)
        _dummy.quaternion.copy(_roll).multiply(_align).multiply(pre)
        _dummy.scale.setScalar(fix.size * shrink)
        _dummy.updateMatrix()
        mesh.setMatrixAt(count, _dummy.matrix)
        count++
      }
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[undefined, undefined, MAX_DETAILS]} frustumCulled={false} />
}

export function WarBases() {
  const session = useSession()
  const bases = session.world.warBases
  return (
    <>
      {bases.map((b) => (
        <Hull key={b.id} base={b} />
      ))}
      {DETAIL_KEYS.map((k) => (
        <DetailBatch key={k} dkey={k} />
      ))}
    </>
  )
}
