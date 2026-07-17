import { BufferGeometry, Matrix4, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * Статуи-монолиты из GLB. Какой облик где — решает домен (`MonolithEntity.variant`).
 *
 * Как и у станций, геометрию НОРМИРУЕМ в единичную сферу и ЦЕНТРИРУЕМ: тогда внешний
 * `scale = radius` даёт нужный габарит (у статуи это десятки километров), и модель можно менять,
 * не трогая числа домена. Материал — родной, лишь пригашенный: Meshy пекёт свет в emissive, и без
 * этого камень «светится» изнутри.
 */

/**
 * Реестр обликов. Сейчас один — Анубис; было три (бык, Анубис, крылатый гений), и в исходниках
 * (`docs/models/statues/`) лежат все. Хочешь другого — меняй ЭТУ строку, а заодно имя в
 * `MONOLITH_NAMES`: ни домен, ни рендер об облике больше ничего не знают.
 *
 * В `public/models` лежит ровно то, что рисуется, и это не аккуратность: GLB грузятся ЖАДНО при
 * импорте модуля, и лишний файл — это его текстуры в видеопамяти навсегда, за просто так.
 * Гигабайт таких «про запас» уже стоил нам половины кадров (см. шапку `GLB_HULLS` в `ships.ts`).
 */
const STATUE_URLS: readonly string[] = [
  '/models/statue_2.glb',
]

/** Сколько обликов статуй. Домен берёт индекс по модулю этого числа. */
export const STATUE_COUNT = STATUE_URLS.length

interface LoadedStatue {
  geometry: BufferGeometry
  material: Material
}

const _center = new Matrix4()
const _norm = new Matrix4()

/** Пригасить самосвечение Meshy: статуя — камень, а не лампа. */
function matteStatue(material: Material): void {
  const m = material as MeshStandardMaterial
  if (m.emissive) m.emissiveIntensity = 0.1
  if (typeof m.metalness === 'number') m.metalness = 0.05
  if (typeof m.roughness === 'number') m.roughness = 0.9
  m.envMapIntensity = 0.25
  m.needsUpdate = true
}

function prepareStatue(scene: Object3D): LoadedStatue | null {
  scene.updateMatrixWorld(true)
  let found: Mesh | null = null
  scene.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh && !found) found = m
  })
  if (!found) return null
  const mesh: Mesh = found
  const g = mesh.geometry.clone()
  g.applyMatrix4(mesh.matrixWorld) // узел нёс свой трансформ — запекаем
  // Центрируем и нормируем в единичную сферу: внешний scale = radius даёт верный габарит.
  g.computeBoundingSphere()
  const bs = g.boundingSphere!
  _center.makeTranslation(-bs.center.x, -bs.center.y, -bs.center.z)
  const s = bs.radius > 1e-6 ? 1 / bs.radius : 1
  _norm.makeScale(s, s, s)
  g.applyMatrix4(_norm.multiply(_center))
  g.computeBoundingSphere()
  const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material
  matteStatue(material)
  return { geometry: g, material }
}

const cache = new Map<number, LoadedStatue>()
for (let i = 0; i < STATUE_URLS.length; i++) {
  const url = STATUE_URLS[i]!
  new GLTFLoader().load(url, (gltf) => {
    const loaded = prepareStatue(gltf.scene)
    if (loaded) cache.set(i, loaded)
  })
}

const wrap = (index: number): number => ((index % STATUE_COUNT) + STATUE_COUNT) % STATUE_COUNT

/** Геометрия облика статуи. null — ещё грузится (статую просто не рисуем). */
export function statueGlbGeometry(index: number): BufferGeometry | null {
  return cache.get(wrap(index))?.geometry ?? null
}

/** Материал облика статуи. null — ещё грузится. */
export function statueGlbMaterial(index: number): Material | null {
  return cache.get(wrap(index))?.material ?? null
}
