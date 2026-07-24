import {
  BufferGeometry,
  Matrix4,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * Военная база: корпус-сфера (реестр `HULL_URLS`, порядок = `WarBaseEntity.shape`) плюс
 * навесные детали — башня, пушки, «глаза», ангар. Каждый GLB нормируем в ЕДИНИЧНУЮ сферу
 * и центрируем: внешний `scale` задаёт настоящий габарит (корпус — радиус базы, деталь —
 * доля радиуса). Материал родной (текстуры Meshy), пригашенный до матового.
 *
 * Данные вместо ветвлений: новый облик — новая строка реестра, не правка кода.
 */

/** Ключи навесных деталей. `tower` — доминанта на полюсе; прочие разбросаны. */
export const DETAIL_KEYS = ['tower', 'gun1', 'gun2', 'eye1', 'pod'] as const
export type DetailKey = (typeof DETAIL_KEYS)[number]

const DETAIL_URLS: Record<DetailKey, string> = {
  tower: '/models/warbase/tower.glb',
  gun1: '/models/warbase/gun1.glb',
  gun2: '/models/warbase/gun2.glb',
  eye1: '/models/warbase/eye1.glb',
  pod: '/models/warbase/pod.glb',
}

interface Loaded {
  geometry: BufferGeometry
  material: Material
}

const _center = new Matrix4()
const _norm = new Matrix4()

/** Пригасить самосвечение Meshy и сделать матовым. */
function matte(material: Material, emissive: number): void {
  const m = material as MeshStandardMaterial
  if (m.emissive) m.emissiveIntensity = emissive
  if (typeof m.metalness === 'number') m.metalness = 0.15
  if (typeof m.roughness === 'number') m.roughness = 0.85
  m.envMapIntensity = 0.25
  m.needsUpdate = true
}

/** Первый меш сцены → центрированная единичная геометрия + его материал. */
function prepare(scene: Object3D, emissive: number): Loaded | null {
  scene.updateMatrixWorld(true)
  let found: Mesh | null = null
  scene.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh && !found) found = m
  })
  if (!found) return null
  const mesh: Mesh = found
  const g = mesh.geometry.clone()
  g.applyMatrix4(mesh.matrixWorld)
  g.computeBoundingSphere()
  const bs = g.boundingSphere!
  _center.makeTranslation(-bs.center.x, -bs.center.y, -bs.center.z)
  const s = bs.radius > 1e-6 ? 1 / bs.radius : 1
  _norm.makeScale(s, s, s)
  g.applyMatrix4(_norm.multiply(_center))
  g.computeBoundingSphere()
  const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material
  matte(material, emissive)
  return { geometry: g, material }
}

const detailCache = new Map<DetailKey, Loaded>()

for (const key of DETAIL_KEYS) {
  new GLTFLoader().load(DETAIL_URLS[key], (gltf) => {
    const loaded = prepare(gltf.scene, 0.3)
    if (loaded) detailCache.set(key, loaded)
  })
}

/**
 * ОСТАНКИ детали: искорёженный обломок на месте отстреленной пушки или глаза.
 *
 * Три облика, и какой куда — выводится из id детали, а не бросается костью. Причина та же,
 * что у всей генерации: одна и та же разбитая пушка обязана выглядеть одинаково и после
 * перезахода, и у соседа по сети. Новый облик — новая строка здесь, без правок сцены.
 *
 * Свечение гасим сильнее, чем у целой детали: обломок мёртв, ему незачем светиться.
 */
const TRASH_URLS = ['/models/warbase/trash/0.glb', '/models/warbase/trash/1.glb', '/models/warbase/trash/2.glb']

export const TRASH_VARIANTS = TRASH_URLS.length

const trashCache = new Map<number, Loaded>()

TRASH_URLS.forEach((url, variant) => {
  new GLTFLoader().load(url, (gltf) => {
    const loaded = prepare(gltf.scene, 0.05)
    if (loaded) trashCache.set(variant, loaded)
  })
})

/** Какой обломок достаётся детали. Детерминировано от её id — то же место, тот же вид. */
export function trashVariantOf(fixtureId: number): number {
  return ((fixtureId % TRASH_VARIANTS) + TRASH_VARIANTS) % TRASH_VARIANTS
}

/** Геометрия обломка. null — ещё грузится. */
export function warBaseTrashGeometry(variant: number): BufferGeometry | null {
  return trashCache.get(variant)?.geometry ?? null
}
/** Материал обломка. null — ещё грузится. */
export function warBaseTrashMaterial(variant: number): Material | null {
  return trashCache.get(variant)?.material ?? null
}

/** Геометрия навесной детали. null — ещё грузится. */
export function warBaseDetailGeometry(key: DetailKey): BufferGeometry | null {
  return detailCache.get(key)?.geometry ?? null
}
/** Материал навесной детали. null — ещё грузится. */
export function warBaseDetailMaterial(key: DetailKey): Material | null {
  return detailCache.get(key)?.material ?? null
}
