import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Texture,
} from 'three'
import { WARBASE, warBaseFixtureWorldPos, renderTime, type WarBaseEntity } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { WARBASE_FX } from '../config'
import {
  DETAIL_KEYS,
  TRASH_VARIANTS,
  trashVariantOf,
  warBaseDetailGeometry,
  warBaseDetailMaterial,
  warBaseTrashGeometry,
  warBaseTrashMaterial,
  type DetailKey,
} from '../geometry/warBaseGlb'
import { planetTexturedMaterial } from '../materials/materials'
import { loadWarBaseTexture } from '../materials/warBaseTextures'
import { worldShrink } from '../worldShrink'

/** Единичная гладкая сфера базы — один раз на модуль. Детализация 6: ~40k тришек, кромок нет. */
let hullSphere: BufferGeometry | null = null
function warBaseHullSphere(): BufferGeometry {
  hullSphere ??= new IcosahedronGeometry(1, 6)
  return hullSphere
}

/** Матовый металл-заглушка, пока нет карты: гладкий тёмный шар лучше гранёного GLB. */
let hullFallback: MeshStandardMaterial | null = null
function warBaseHullFallback(): MeshStandardMaterial {
  hullFallback ??= new MeshStandardMaterial({ color: 0x6b7079, metalness: 0.2, roughness: 0.82 })
  return hullFallback
}

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

/**
 * Корпус базы — ГЛАДКИЙ ШАР (сфера + equirect-карта, как планета), а не гранёный GLB.
 *
 * Гранёная модель давала «углы» и мыло, а её твердь не совпадала с видимой сферой — корабль
 * проваливался под борт. Икосаэдр высокой детализации гладок и несёт сферическую UV без шва,
 * так что карта ложится ровно, а радиус шара = радиусу коллизии (`warBaseSolidRadius`): над
 * чем летишь, на то и садишься. Нет карты — матовый металл-заглушка, но всё так же гладкая.
 *
 * Их единицы — обычный меш на базу, инстансинг не нужен. Детали (башни, пушки) — отдельно.
 */
function Hull({ base }: { base: WarBaseEntity }) {
  const session = useSession()
  const ref = useRef<Mesh>(null)
  const geometry = useMemo(warBaseHullSphere, [])
  const texture = useRef<Texture | null>(null)

  useEffect(() => loadWarBaseTexture(base.shape, (t) => (texture.current = t)), [base.shape])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const shrink = worldShrink(session.world.player.state.scale)
    if (shrink <= 0 || !base.alive) {
      mesh.visible = false
      return
    }
    mesh.visible = true
    const material = texture.current ? planetTexturedMaterial(texture.current) : warBaseHullFallback()
    if (mesh.material !== material) mesh.material = material
    mesh.position.copy(base.pos)
    mesh.quaternion.setFromAxisAngle(base.spinAxis, base.spin * renderTime(session.world))
    mesh.scale.setScalar(base.radius * shrink)
  })
  return <mesh ref={ref} geometry={geometry} frustumCulled={false} />
}

/** Обломок мельче целой детали: от неё остался огрызок, а не она сама. */
const TRASH_SCALE = 0.62
/** Насколько обломок УТОПЛЕН в обшивку, в долях своего габарита: он врос, а не лежит. */
const TRASH_SINK = 0.55
/** Пакеты обломков — по одному на облик. Список постоянный, считается один раз. */
const TRASH_KEYS = Array.from({ length: TRASH_VARIANTS }, (_, i) => i)

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

    const time = renderTime(session.world)
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

/**
 * ОСТАНКИ отстреленных деталей — по одному пакету на облик обломка.
 *
 * Сбитая пушка не исчезает бесследно: на её месте остаётся искорёженный обломок, вросший
 * в обшивку. Так видно, что база уже потрёпана, а не «была такой всегда».
 *
 * Место и разворот — те же, что у целой детали (одна формула на луч, деталь и обломок),
 * но обломок мельче и сидит ГЛУБЖЕ: центр опускаем на разницу выступов, иначе огрызок
 * висел бы над обшивкой на высоте снесённой башни. Крен берём от той же `roll`, чтобы
 * обломки не встали строем.
 */
function TrashBatch({ variant }: { variant: number }) {
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
    for (const base of session.world.warBases) {
      if (!base.alive) continue
      for (const fix of base.fixtures) {
        if (fix.alive || trashVariantOf(fix.id) !== variant || count >= MAX_DETAILS) continue
        const size = fix.size * TRASH_SCALE
        warBaseFixtureWorldPos(base, fix, time, _pos)
        _dir.copy(_pos).sub(base.pos).normalize()
        // ОСАДКА: обломок не просто ниже целой детали — он ВДАВЛЕН в обшивку. Разницы
        // выступов не хватало, огрызок парил над бортом; топим его ещё на долю габарита,
        // и он читается как вросший в корпус, а не приклеенный к воздуху.
        _pos.addScaledVector(_dir, -(fix.size - size) * WARBASE.FIXTURE_SIT_OUT - size * TRASH_SINK)
        _dummy.position.copy(_pos).sub(base.pos).multiplyScalar(shrink).add(base.pos)
        _align.setFromUnitVectors(_UP, _dir)
        _roll.setFromAxisAngle(_dir, fix.roll)
        _dummy.quaternion.copy(_roll).multiply(_align)
        _dummy.scale.setScalar(size * shrink)
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
      {TRASH_KEYS.map((v) => (
        <TrashBatch key={v} variant={v} />
      ))}
    </>
  )
}
