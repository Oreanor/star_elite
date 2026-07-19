import { BufferGeometry, Matrix4, type Material, type Mesh, type Object3D, type MeshStandardMaterial } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MATERIAL } from '../config'

/**
 * Станции из GLB-моделей (Meshy). Пять обликов; какой в какой системе — решает домен по
 * СИДУ системы (детерминированно, потому у всех клиентов станция одинакова). Здесь только
 * загрузка и подготовка: геометрию НОРМИРУЕМ в единичный размер и ЦЕНТРИРУЕМ, чтобы внешний
 * `scale = body.radius` давал верный габарит (как у процедурных станций). Материал — родной
 * (текстуры Meshy), лишь пригашенный до матового (иначе Meshy «светится» запечённым светом).
 *
 * Данные вместо ветвлений: новая станция — новый файл в STATION_URLS, не правка рендера.
 */

const STATION_URLS: readonly string[] = [
  '/models/station_1.glb',
  '/models/station_2.glb',
  '/models/station_3.glb',
  '/models/station_4.glb',
  '/models/station_5.glb',
]

/** Сколько обликов станций. Домен берёт индекс по модулю этого числа. */
export const STATION_MODEL_COUNT = STATION_URLS.length

interface LoadedStation {
  geometry: BufferGeometry
  material: Material
}

const _center = new Matrix4()
const _norm = new Matrix4()

/** Пригасить самосвечение Meshy и сделать матовым — как у корпусов кораблей. */
function matteStation(material: Material): void {
  const m = material as MeshStandardMaterial
  if (m.emissive) m.emissiveIntensity = 0.15
  if (typeof m.metalness === 'number') m.metalness = MATERIAL.GLB_STATION_METALNESS
  if (typeof m.roughness === 'number') m.roughness = MATERIAL.GLB_STATION_ROUGHNESS
  m.envMapIntensity = MATERIAL.GLB_STATION_ENV
  m.needsUpdate = true
}

function prepareStation(scene: Object3D): LoadedStation | null {
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
  // Центрируем и нормируем в единичную сферу: тогда внешний scale=radius даёт нужный габарит.
  g.computeBoundingSphere()
  const bs = g.boundingSphere!
  _center.makeTranslation(-bs.center.x, -bs.center.y, -bs.center.z)
  const s = bs.radius > 1e-6 ? 1 / bs.radius : 1
  _norm.makeScale(s, s, s)
  g.applyMatrix4(_norm.multiply(_center))
  g.computeBoundingSphere()
  const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material
  matteStation(material)
  return { geometry: g, material }
}

/**
 * Грузим ПО ТРЕБОВАНИЮ — тот облик, что спросили, и только его.
 *
 * Прежде тянули все пять при импорте модуля, хотя причал в системе всегда ОДИН: четыре модели
 * жили в памяти просто так. При картах 2048² это по 90 МБ на облик — 360 МБ за то, чего в кадре
 * нет и не будет. Ленивость и есть тот запас, на который станциям вернули 2048: разглядывают их
 * в упор, и разрешение им нужнее, чем истребителю.
 *
 * Прыгнул в систему с другим причалом — модель приедет тогда же. Ждать никому не приходится:
 * пока её нет, `Bodies.tsx` держит процедурную заглушку и подменяет её по идентичности, как и
 * раньше при первой загрузке.
 */
const cache = new Map<number, LoadedStation>()
const loading = new Set<number>()

function requestStation(index: number): void {
  if (cache.has(index) || loading.has(index)) return
  const url = STATION_URLS[index]
  if (!url) return
  loading.add(index)
  new GLTFLoader().load(url, (gltf) => {
    const loaded = prepareStation(gltf.scene)
    if (loaded) cache.set(index, loaded)
    loading.delete(index)
  })
}

/**
 * КРЕСТ «Вечность» — особый: он монумент-храм, а не рядовой причал, и облик у него не из общей
 * пятёрки. Берём только ГЕОМЕТРИЮ: материал ему рисует божественный шейдер (плывущий силуэт,
 * раскалённые кромки), а не текстуры Meshy — оттого `prepareStation` тут нужен лишь ради
 * центровки и нормировки в единичный размер (внешний scale = радиус станции).
 */
const CROSS_URL = '/models/station_cross.glb'
let crossCache: LoadedStation | null = null
new GLTFLoader().load(CROSS_URL, (gltf) => {
  const loaded = prepareStation(gltf.scene)
  if (loaded) crossCache = loaded
})

/** Геометрия Креста. null — ещё грузится (вызывающий держит процедурную заглушку). */
export function crossGlbGeometry(): BufferGeometry | null {
  return crossCache?.geometry ?? null
}

const wrap = (index: number): number =>
  ((index % STATION_MODEL_COUNT) + STATION_MODEL_COUNT) % STATION_MODEL_COUNT

/**
 * Геометрия облика станции по индексу (по модулю числа обликов). null — ещё грузится.
 *
 * СПРОСИТЬ — ЗНАЧИТ ЗАКАЗАТЬ: первый вопрос про облик и запускает его загрузку. Зовут это
 * из кадра, поэтому повторный заказ отсекается (`loading`), а не шлёт запрос по 60 раз в
 * секунду.
 */
export function stationGlbGeometry(index: number): BufferGeometry | null {
  const i = wrap(index)
  requestStation(i)
  return cache.get(i)?.geometry ?? null
}

/** Материал облика станции по индексу. null — ещё грузится (заказ уже сделан). */
export function stationGlbMaterial(index: number): Material | null {
  const i = wrap(index)
  requestStation(i)
  return cache.get(i)?.material ?? null
}
