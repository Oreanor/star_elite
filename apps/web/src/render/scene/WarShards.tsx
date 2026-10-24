import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Euler, InstancedMesh, Object3D, Quaternion, Vector3, type Texture } from 'three'
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
import { worldShrink, zoomAround } from '../worldShrink'
import { PANEL_VARIANTS, panelVariantOf, warBasePanelGeometry, warBasePanelMaterial } from '../geometry/warBasePanels'
import { WARBASE_TEXTURE_COUNT, loadWarBaseTexture, warBaseTextureOf } from '../materials/warBaseTextures'

/**
 * ОСКОЛКИ военной базы, снесённой разрушающим шаром: уцелевшие турели летят целиком, а
 * рванувшие детали и куски обшивки — огрызками оснований (те же меши, что остаются на месте
 * сбитой детали). Летят и крутятся, как посчитал домен (`world.warShards`); облик одного вида —
 * один InstancedMesh.
 */

const MAX_SHARDS = 512
const _dummy = new Object3D()
const _shardAt = new Vector3()
/** Поза осколка между тактами: откат по скорости на недоделанную долю такта (как у шара). */
function place(world: World, shard: WarShard, time: number, shrink: number, pre: Quaternion | null): void {
  _shardAt.copy(shard.pos).addScaledVector(shard.vel, -(1 - world.renderAlpha) * PHYSICS.FIXED_DT)
  // Ужат с базой: к её центру тем же множителем, что и она сама.
  zoomAround(_shardAt, shard.zoomAt, shrink, _dummy.position)
  const size = shard.size * shrink
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
      place(session.world, s, time, shrink, pre)
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
      place(session.world, s, time, shrink, null)
      mesh.setMatrixAt(count++, _dummy.matrix)
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[undefined, undefined, MAX_SHARDS]} frustumCulled={false} />
}

const TRASH_KEYS = Array.from({ length: TRASH_VARIANTS }, (_, i) => i)

/**
 * Листы обшивки одной карты и одной формы — один InstancedMesh. Карта — та же, что на корпусе
 * снесённой базы (`model` листа — облик корпуса); пока не пришла — матовый металл.
 */
function PanelShards({ skin, variant }: { skin: number; variant: number }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)
  const texture = useRef<Texture | null>(null)
  useEffect(() => loadWarBaseTexture(skin, (t) => (texture.current = t)), [skin])
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const shrink = worldShrink(session.world.player.state.scale)
    const m = warBasePanelMaterial(texture.current)
    if (mesh.material !== m) mesh.material = m
    const time = renderTime(session.world)
    let count = 0
    if (shrink > 0) {
      for (const s of session.world.warShards) {
        if (s.kind !== 'panel' || warBaseTextureOf(s.model) !== skin || panelVariantOf(s.seed) !== variant) continue
        if (count >= MAX_SHARDS) break
        place(session.world, s, time, shrink, null)
        mesh.setMatrixAt(count++, _dummy.matrix)
      }
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[warBasePanelGeometry(variant), undefined, MAX_SHARDS]} frustumCulled={false} />
}

const PANEL_KEYS = Array.from({ length: WARBASE_TEXTURE_COUNT * PANEL_VARIANTS }, (_, i) => i)

export function WarShards() {
  return (
    <>
      {DETAIL_KEYS.map((k) => (
        <DetailShards key={k} dkey={k} />
      ))}
      {TRASH_KEYS.map((v) => (
        <TrashShards key={v} variant={v} />
      ))}
      {PANEL_KEYS.map((k) => (
        <PanelShards key={k} skin={Math.floor(k / PANEL_VARIANTS)} variant={k % PANEL_VARIANTS} />
      ))}
    </>
  )
}
