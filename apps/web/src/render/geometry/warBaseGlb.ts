import {
  BufferGeometry,
  Matrix4,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
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

const HULL_URLS: readonly string[] = [
  '/models/warbase/hull_0.glb',
  '/models/warbase/hull_1.glb',
]

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

export const HULL_MODEL_COUNT = HULL_URLS.length

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

const hullCache = new Map<number, Loaded>()
const detailCache = new Map<DetailKey, Loaded>()

for (let i = 0; i < HULL_URLS.length; i++) {
  const url = HULL_URLS[i]!
  // Корпус светится окнами чуть заметнее — база жилая.
  new GLTFLoader().load(url, (gltf) => {
    const loaded = prepare(gltf.scene, 0.2)
    if (loaded) hullCache.set(i, loaded)
  })
}
for (const key of DETAIL_KEYS) {
  new GLTFLoader().load(DETAIL_URLS[key], (gltf) => {
    const loaded = prepare(gltf.scene, 0.3)
    if (loaded) detailCache.set(key, loaded)
  })
}

const wrapHull = (i: number): number => ((i % HULL_MODEL_COUNT) + HULL_MODEL_COUNT) % HULL_MODEL_COUNT

/** Геометрия корпуса базы. null — ещё грузится. */
export function warBaseHullGeometry(index: number): BufferGeometry | null {
  return hullCache.get(wrapHull(index))?.geometry ?? null
}
/** Материал корпуса базы. null — ещё грузится. */
export function warBaseHullMaterial(index: number): Material | null {
  return hullCache.get(wrapHull(index))?.material ?? null
}
/** Геометрия навесной детали. null — ещё грузится. */
export function warBaseDetailGeometry(key: DetailKey): BufferGeometry | null {
  return detailCache.get(key)?.geometry ?? null
}
/** Материал навесной детали. null — ещё грузится. */
export function warBaseDetailMaterial(key: DetailKey): Material | null {
  return detailCache.get(key)?.material ?? null
}

/** Albedo корпуса — ею кроем простые меши осколков. null, пока GLB не готов. */
export function warBaseGlbMap(index: number): Texture | null {
  const material = hullCache.get(wrapHull(index))?.material as MeshStandardMaterial | undefined
  return material?.map ?? null
}
