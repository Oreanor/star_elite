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
 * Декоративные глыбы двора статуи. Как у монолитов: нормируем в единичную сферу,
 * центрируем — внешний `scale = radius` даёт километровый габарит. Материал родной,
 * пригашенный: Meshy печёт свет в emissive.
 *
 * Порядок = `ScenicRockEntity.shape`. В `public/models` только то, что рисуется.
 */

const ROCK_URLS: readonly string[] = [
  '/models/balls/asteroid_1.glb',
  '/models/balls/asteroid_2.glb',
]

export const SCENIC_ROCK_COUNT = ROCK_URLS.length

interface LoadedRock {
  geometry: BufferGeometry
  material: Material
}

const _center = new Matrix4()
const _norm = new Matrix4()

function matteRock(material: Material): void {
  const m = material as MeshStandardMaterial
  if (m.emissive) m.emissiveIntensity = 0.08
  if (typeof m.metalness === 'number') m.metalness = 0.05
  if (typeof m.roughness === 'number') m.roughness = 0.95
  m.envMapIntensity = 0.2
  m.needsUpdate = true
}

function prepareRock(scene: Object3D): LoadedRock | null {
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
  matteRock(material)
  return { geometry: g, material }
}

const cache = new Map<number, LoadedRock>()
for (let i = 0; i < ROCK_URLS.length; i++) {
  const url = ROCK_URLS[i]!
  new GLTFLoader().load(url, (gltf) => {
    const loaded = prepareRock(gltf.scene)
    if (loaded) cache.set(i, loaded)
  })
}

const wrap = (index: number): number => ((index % SCENIC_ROCK_COUNT) + SCENIC_ROCK_COUNT) % SCENIC_ROCK_COUNT

/** Геометрия облика. null — ещё грузится. */
export function scenicRockGlbGeometry(index: number): BufferGeometry | null {
  return cache.get(wrap(index))?.geometry ?? null
}

/** Материал облика. null — ещё грузится. */
export function scenicRockGlbMaterial(index: number): Material | null {
  return cache.get(wrap(index))?.material ?? null
}

/** Albedo-карта облика — ею кроем простые меши осколков. null, пока GLB не готов. */
export function scenicRockGlbMap(index: number): Texture | null {
  const material = cache.get(wrap(index))?.material as MeshStandardMaterial | undefined
  return material?.map ?? null
}
