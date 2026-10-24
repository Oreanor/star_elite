import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Euler, InstancedMesh, Object3D, Quaternion } from 'three'
import { PHYSICS, renderTime, type WarShard, type World } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { WARBASE_FX } from '../config'
import {
  DETAIL_KEYS,
  TRASH_VARIANTS,
  detailKeyOf,
  trashVariantOf,
  warBaseDetailGeometry,
  warBaseDetailMaterial,
  warBaseTrashGeometry,
  warBaseTrashMaterial,
  type DetailKey,
} from '../geometry/warBaseGlb'
import { worldShrink } from '../worldShrink'

/**
 * ОСКОЛКИ военной базы, снесённой разрушающим шаром: уцелевшие турели летят целиком, а
 * рванувшие детали и куски обшивки — огрызками оснований (те же меши, что остаются на месте
 * сбитой детали). Летят и крутятся, как посчитал домен (`world.warShards`); облик одного вида —
 * один InstancedMesh.
 */

const MAX_SHARDS = 512
const _dummy = new Object3D()
/** Поза осколка между тактами: откат по скорости на недоделанную долю такта (как у шара). */
function place(world: World, shard: WarShard, time: number, size: number, pre: Quaternion | null): void {
  _dummy.position.copy(shard.pos).addScaledVector(shard.vel, -(1 - world.renderAlpha) * PHYSICS.FIXED_DT)
  _dummy.quaternion.setFromAxisAngle(shard.axis, shard.spin * (time - shard.born))
  if (pre) _dummy.quaternion.multiply(pre)
  _dummy.scale.setScalar(size)
  _dummy.updateMatrix()
}

function DetailShards({ dkey }: { dkey: DetailKey }) {
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
    const time = renderTime(session.world)
    let count = 0
    for (const s of session.world.warShards) {
      if (s.kind !== 'detail' || detailKeyOf(s.model) !== dkey || count >= MAX_SHARDS) continue
      place(session.world, s, time, s.size * shrink, pre)
      mesh.setMatrixAt(count++, _dummy.matrix)
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[undefined, undefined, MAX_SHARDS]} frustumCulled={false} />
}

function TrashShards({ variant }: { variant: number }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const g = warBaseTrashGeometry(variant)
    const m = warBaseTrashMaterial(variant)
    const shrink = worldShrink(session.world.player.state.scale)
    if (!g || !m || shrink <= 0) {
      mesh.count = 0
      return
    }
    if (mesh.geometry !== g) mesh.geometry = g
    if (mesh.material !== m) mesh.material = m
    const time = renderTime(session.world)
    let count = 0
    for (const s of session.world.warShards) {
      if (s.kind !== 'trash' || trashVariantOf(s.seed) !== variant || count >= MAX_SHARDS) continue
      place(session.world, s, time, s.size * shrink, null)
      mesh.setMatrixAt(count++, _dummy.matrix)
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[undefined, undefined, MAX_SHARDS]} frustumCulled={false} />
}

const TRASH_KEYS = Array.from({ length: TRASH_VARIANTS }, (_, i) => i)

export function WarShards() {
  return (
    <>
      {DETAIL_KEYS.map((k) => (
        <DetailShards key={k} dkey={k} />
      ))}
      {TRASH_KEYS.map((v) => (
        <TrashShards key={v} variant={v} />
      ))}
    </>
  )
}
