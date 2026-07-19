import { BufferGeometry, Matrix4, type Material, type Mesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MATERIAL, PALETTE } from '../config'
import { buildGeometry, quad, symmetric, tri, type Triangle, type Vec3 } from './build'
import { bell, panel } from './parts'

/**
 * Корпуса кораблей. Нос смотрит в −Z, верх — +Y, правый борт — +X.
 *
 * Пишем только правую половину и зеркалим: силуэт тогда симметричен по построению,
 * а править надо вдвое меньше вершин. Детали, стоящие НА оси (киль, антенна),
 * зеркалить нельзя — две совпадающие грани дадут мерцание в буфере глубины.
 * Поэтому они собираются отдельно и добавляются к готовой симметричной половине.
 *
 * Размеры согласованы с физикой: сфера столкновений «Авроры» — 12 м,
 * значит корпус около 26 м в длину и 24 в размахе. Это не косметика —
 * угловой размер цели решает, возможно ли по ней попасть.
 *
 * Сложность держим в деталях, а не в кривизне: гранёный силуэт остаётся
 * читаемым издали, а расшивка, лючки и сопла работают вблизи. Полигонов
 * это стоит сотни — то есть нисколько: весь класс рисуется одним вызовом.
 */

const {
  HULL,
  HULL_DARK,
  HULL_ACCENT,
  HULL_LINE,
  HULL_SHADE,
  HULL_TRIM,
  ENGINE,
  ENGINE_CORE,
} = PALETTE

/**
 * Срез сопла: где на корпусе рождается факел и какой он ширины (метры модельного
 * пространства, нос −Z, корма +Z). Общий тип для всего рендера — им пользуются и
 * загруженные GLB-корпуса (сопла считаются из габаритов), и ракета с дроном.
 */
export interface Nozzle {
  offset: Vec3
  radius: number
}

// ─── Ракета ──────────────────────────────────────────────────────────────────
//
// Заведомо крупнее калибра. Настоящая ракета длиной метр-полтора на дистанции
// в километр занимает доли пикселя: игрок физически не видит, что в него летит,
// и «уворачиваться от ракет» превращается в угадывание. Восемь метров — это
// сознательная ложь ради читаемости, и она стоит дешевле, чем непонятная смерть.

const M_NOSE: Vec3 = [0, 0, -4.6]
const M_SHOULDER_R: Vec3 = [0.75, 0, -2.6]
const M_SHOULDER_T: Vec3 = [0, 0.75, -2.6]
const M_TAIL_R: Vec3 = [0.75, 0, 3.0]
const M_TAIL_T: Vec3 = [0, 0.75, 3.0]
/** Юбка сопла: срез шире корпуса, и на нём видно пламя. */
const M_SKIRT_R: Vec3 = [0.95, 0, 4.0]
const M_SKIRT_T: Vec3 = [0, 0.95, 4.0]

let missileCache: BufferGeometry | null = null

/** Четырёхгранная игла: на скорости 420 м/с деталей всё равно не разглядеть. */
export function missileGeometry(): BufferGeometry {
  if (missileCache) return missileCache

  const quarter: Triangle[] = [
    tri(M_NOSE, M_SHOULDER_R, M_SHOULDER_T, HULL),
    ...quad(M_SHOULDER_R, M_TAIL_R, M_TAIL_T, M_SHOULDER_T, PALETTE.MISSILE),
    // Полоса-опознаватель: на белом корпусе видно, что это не обломок.
    ...panel([0.76, 0, -1.6], [0, 0.76, -1.6], [0, 0.76, -0.6], [0.76, 0, -0.6], HULL_ACCENT, [0.03, 0.03, 0]),
    /**
     * Стабилизатор: без него ракета выглядит гвоздём.
     *
     * Размах 1.35 м, не 2.4: верхнее перо торчало выше пилона и протыкало крыло
     * насквозь. Ракета вдобавок стала легче на вид — крупное оперение делало
     * её похожей на самолёт, а она игла.
     */
    tri([0.62, 0, 2.0], [1.35, 0, 3.8], [0.62, 0, 3.6], HULL_LINE),
    // Раструб сопла и жерло.
    ...quad(M_TAIL_R, M_SKIRT_R, M_SKIRT_T, M_TAIL_T, HULL_DARK),
    tri(M_SKIRT_R, [0, 0, 3.8], M_SKIRT_T, ENGINE_CORE),
  ]

  // Четыре поворота вокруг оси Z дают полную иглу из одной четверти.
  const all: Triangle[] = []
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2
    const rot = ([x, y, z]: Vec3): Vec3 => [
      x * Math.cos(a) - y * Math.sin(a),
      x * Math.sin(a) + y * Math.cos(a),
      z,
    ]
    all.push(...quarter.map((t) => tri(rot(t.a), rot(t.b), rot(t.c), t.color)))
  }
  missileCache = buildGeometry(all)
  return missileCache
}

/** Сопло ракеты. Радиус великоват для калибра — иначе факел не видно издали. */
export const MISSILE_NOZZLE: Nozzle = { offset: [0, 0, 4.0], radius: 1.35 }

// ─── БПЛА «Оса» ──────────────────────────────────────────────────────────────
//
// Три метра в поперечнике: на дистанции боя это несколько пикселей. Поэтому
// силуэт, а не детали — гранёное ядро, два крылышка-плиты и сопло. Расшивку
// сюда класть незачем: её не увидит никто, а полигоны сожрёт.

const D_NOSE: Vec3 = [0, 0, -3.0]
const D_TOP: Vec3 = [0, 0.55, -0.4]
const D_BOT: Vec3 = [0, -0.5, -0.2]
const D_SIDE: Vec3 = [0.75, 0.0, -0.3]
const D_TAIL_T: Vec3 = [0, 0.45, 2.0]
const D_TAIL_B: Vec3 = [0, -0.4, 2.0]
const D_TAIL_S: Vec3 = [0.6, 0.0, 2.0]

/** Крылышко-плита. Оно же радиатор: аппарат греется сильнее, чем остывает. */
const D_WING_ROOT_F: Vec3 = [0.6, 0.05, -0.2]
const D_WING_ROOT_B: Vec3 = [0.6, 0.05, 1.5]
const D_WING_TIP: Vec3 = [2.3, 0.05, 1.1]

const droneHalf: Triangle[] = [
  tri(D_NOSE, D_SIDE, D_TOP, HULL),
  tri(D_NOSE, D_BOT, D_SIDE, HULL_DARK),
  ...quad(D_TOP, D_SIDE, D_TAIL_S, D_TAIL_T, HULL_SHADE),
  ...quad(D_SIDE, D_BOT, D_TAIL_B, D_TAIL_S, HULL_DARK),

  tri(D_WING_ROOT_F, D_WING_TIP, D_WING_ROOT_B, HULL_ACCENT),
  tri(D_WING_ROOT_F, D_WING_ROOT_B, D_WING_TIP, HULL_TRIM),

  // Торец кормы: срез, а не обшивка.
  ...quad(D_TAIL_T, D_TAIL_S, D_TAIL_B, D_TAIL_B, HULL_TRIM),
]

const droneCentre: Triangle[] = [...bell(0, 0.0, 2.05, 0.28, 0.36, 0.5, 6, ENGINE, ENGINE_CORE)]

let droneCache: BufferGeometry | null = null

export function droneGeometry(): BufferGeometry {
  droneCache ??= buildGeometry([...symmetric(droneHalf), ...droneCentre])
  return droneCache
}

export const DRONE_NOZZLES: readonly Nozzle[] = [{ offset: [0, 0, 2.05], radius: 0.34 }]

// ─── GLB-корпуса: загруженные меши Meshy с РОДНЫМИ ТЕКСТУРАМИ ─────────────────
//
// В отличие от процедурных корпусов (плоские грани + вершинные цвета), это внешние сетки
// со своими картами (baseColor/emissive/normal/metalRough). Все из одного пайплайна Meshy и
// лежат ОДИНАКОВО (длина по X, верх — малая ось Y), поэтому дефолтный разворот годится всем;
// модель-исключение переопределит углы в своей строке реестра. Материал берём как есть (по UV
// ложатся текстуры), геометрию приводим к конвенции движка (нос −Z, верх +Y, метры).
//
// Данные вместо ветвлений (OCP): новый GLB-корпус = строка в GLB_HULLS + шасси в домене.

/**
 * Готовый корпус из GLB: геометрия в конвенции движка + СВОЙ материал с текстурами.
 * Сопла НЕ хранятся в реестре, а считаются из габаритов загруженной модели (см. tailNozzles) —
 * позиция масштабируется под любой корабль сама, руками под каждый меш не подбираем.
 */
interface LoadedHull {
  geometry: BufferGeometry
  material: Material
  nozzles: readonly Nozzle[]
}

/** Описание GLB-корпуса: файл, масштаб, разворот в конвенцию движка. Сопла — из габаритов. */
interface GlbHullDef {
  readonly id: string
  readonly url: string
  readonly scale: number
  /** Развороты (рад) вокруг Y/X/Z: длину модели ставят вдоль Z (нос −Z), спину вверх. */
  readonly yaw: number
  readonly pitch: number
  readonly roll: number
  /**
   * СВОИ сопла под конкретную модель (метры модельного пространства, нос −Z, корма +Z). Нужны,
   * когда авто-формула по габаритам мажет: напр. у «Авроры One» выхлоп бьёт из ДВУХ центральных
   * движков, а не с концов крыла (куда авто-разнос его унёс). Нет поля — берётся `tailNozzles`.
   */
  readonly nozzles?: readonly Nozzle[]
}

/**
 * Дефолт разворота для Meshy-моделей одного пайплайна: длина по X → вдоль Z поворотом на
 * 90° вокруг Y; нос при этом уходит в +Z и корабль кверху брюхом — доворот на 180° вокруг
 * X и Z чинит нос (→ −Z) и спину (→ вверх). Масштаб — единичный куб до ~22 м. Модель легла
 * иначе — переопредели углы в её строке (выхлоп должен бить из кормы, спина смотреть вверх).
 */
const GLB_YAW = Math.PI / 2
const GLB_PITCH = Math.PI
const GLB_ROLL = Math.PI
/** Единичный куб → метры. 16 (не 22): на 22 корма лезла в камеру преследования. */
const GLB_SCALE = 16

/**
 * БЮДЖЕТ ВИДЕОПАМЯТИ. Цена ошибки тут сильно больше, чем кажется по файлу на диске, и однажды
 * она уже стоила нам половины кадров.
 *
 * Meshy отдаёт четыре карты 2048² (цвет, нормаль, металл-шершавость, свечение). В webp они
 * весят смешные полмегабайта, и модель выглядит лёгкой — но в GPU текстура разворачивается
 * несжатой: 2048² × RGBA × мипы = 22 МБ КАЖДАЯ, 89 МБ на модель. Тринадцать моделей = 1.16 ГБ,
 * и это была ровно та просадка 60 → 30. Полигонаж при этом образцовый (~1000 тришек на корабль),
 * draw call-ов в кадре пять — ломаться было нечему, кроме памяти.
 *
 * ПРАВИЛО: РАЗРЕШЕНИЕ ИДЁТ ЗА РАЗМЕРОМ НА ЭКРАНЕ, а не за важностью модели.
 *
 *   2048² (89 МБ)  — станции, статуя, «Атлас». Их разглядывают в упор, и они занимают экран
 *                    целиком: на 1024 видно мыло.
 *   1024² (22 МБ)  — истребители. Мельче кадра, разницы с 2048 не видно.
 *   256²           — НЕ ГОДИТСЯ НИКОМУ: пробовали, «жуткое мыло». Модели текстурные, а не
 *                    крашеные по вершинам — весь рисунок корпуса живёт в карте цвета и уходит
 *                    вместе с её разрешением. Довод «корабль = пара сотен пикселей» ложен: его
 *                    разглядывают вблизи, в верфи и на облёте камерой.
 *
 * Ужиматься перестали не от жадности: станции теперь грузятся ЛЕНИВО (`stationGlb.ts`) — в
 * системе причал один, и четыре чужих облика больше не висят в памяти. Этот запас и отдан под
 * их 2048. Корпуса же грузятся ЖАДНО, при импорте модуля, — их бюджет считай по ВСЕМУ реестру,
 * а не по тому, что сейчас в кадре.
 *
 * ЗАМЕРЯЕШЬ — ПЕРЕЗАГРУЗИ СТРАНИЦУ. На этом сгорел целый заход: модель грузится ОДИН раз, при
 * старте, и подмена файла на диске уже загруженную не трогает — горячая замена её не ловит.
 * Ужали до 256², померили «всё те же 30» и пошли искать причину в блуме — а мерили всё те же
 * 2048², которых на диске давно не было. Число, снятое без перезагрузки, не значит ничего.
 * Кадры мерить прибором `Probe` (F3).
 *
 * Шаг пайплайна (после `dequantize`, перед укладкой в `public/models`):
 *   npx @gltf-transform/cli resize --width 1024 --height 1024 in.glb out.glb
 */
const GLB_HULLS: readonly GlbHullDef[] = [
  // Spiritus экспортирован вдвое крупнее остальных Meshy-корпусов; scale 8 сохраняет длину 16 м.
  // У силовой установки одно центральное сопло — это часть идентичности корпуса, не авторазводка.
  { id: 'spiritus_sanctus', url: '/models/dove4.glb', scale: GLB_SCALE / 2,
    yaw: GLB_YAW - Math.PI / 2, pitch: GLB_PITCH + Math.PI / 18, roll: GLB_ROLL,
    nozzles: [{ offset: [0, -0.65, 5], radius: 1.25 }] },
  // «Аврора One»: выхлоп из ДВУХ центральных движков (тёмные тубусы). Сопла придвинуты ВПЕРЁД
  // к устьям движков (z 8.5, не 11 — иначе плюмаж отрывался от кормы) и опущены на ось тубусов.
  { id: 'aurora_one', url: '/models/aurora_one.glb', scale: GLB_SCALE, yaw: GLB_YAW, pitch: GLB_PITCH, roll: GLB_ROLL,
    nozzles: [{ offset: [-1.5, -0.7, 7.5], radius: 1 }, { offset: [1.5, -0.7, 7.5], radius: 1 }] },
  { id: 'hermes', url: '/models/hermes.glb', scale: GLB_SCALE, yaw: GLB_YAW, pitch: GLB_PITCH, roll: GLB_ROLL },
  { id: 'perseus', url: '/models/perseus.glb', scale: GLB_SCALE, yaw: GLB_YAW, pitch: GLB_PITCH, roll: GLB_ROLL },
  { id: 'pegasus', url: '/models/pegasus.glb', scale: GLB_SCALE, yaw: GLB_YAW, pitch: GLB_PITCH, roll: GLB_ROLL },
  { id: 'orion', url: '/models/orion.glb', scale: GLB_SCALE, yaw: GLB_YAW, pitch: GLB_PITCH, roll: GLB_ROLL },
  // «Тесей» — лёгкий истребитель (933 тришки).
  { id: 'theseus', url: '/models/theseus.glb', scale: GLB_SCALE, yaw: GLB_YAW, pitch: GLB_PITCH, roll: GLB_ROLL },
  /**
   * «Атлас» — КОРАБЛЬ ПОКОЛЕНИЙ, и масштаб у него не «побольше прочих», а другого порядка:
   * 120 против 16 у истребителя. Это ковчег, в нём живут, — рядом с ним истребитель обязан
   * читаться мошкой, иначе он просто широкий грузовик.
   *
   * Число ходит В ПАРЕ с `radius` его шасси (`chassis.ts`): им ловят попадания, и разъедься
   * они — лучи пойдут сквозь борт, не задев. Растишь одно — расти и второе.
   */
  { id: 'atlas', url: '/models/atlas.glb', scale: 120, yaw: GLB_YAW, pitch: GLB_PITCH, roll: GLB_ROLL },
]

const _rotY = new Matrix4()
const _rotX = new Matrix4()
const _rotZ = new Matrix4()
const _scaleM = new Matrix4()

/**
 * Пригашаем самосвечение Meshy (emissive на полную — оттого корпус «светился») и делаем
 * матовый пластик: неметалл, высокая шершавость, меньше отражений неба. Мутируем материал
 * GLB напрямую — он наш, один на корпус.
 */
function matteGlbHull(material: Material): void {
  const m = material as import('three').MeshStandardMaterial
  if (m.emissive) m.emissiveIntensity = 0.12
  // Чуть металла — звезда даёт спекуляр; полный пластик (0) блика не ловил.
  if (typeof m.metalness === 'number') m.metalness = MATERIAL.GLB_HULL_METALNESS
  if (typeof m.roughness === 'number') m.roughness = MATERIAL.GLB_HULL_ROUGHNESS
  m.envMapIntensity = MATERIAL.GLB_HULL_ENV
  m.needsUpdate = true
}

/**
 * ДВА сопла из ГАБАРИТОВ модели. Корма корабля — в +Z (конвенция движка), поэтому сопла
 * садим на `max.z`; разносим по ширине корпуса и радиус берём от поперечного сечения. Всё
 * от bounding box уже приведённой геометрии — позиция сама масштабируется под любой корабль,
 * руками под каждый меш ничего не подбираем. Условились: у каждого GLB-корпуса ровно два.
 */
function tailNozzles(box: import('three').Box3): Nozzle[] {
  const cx = (box.min.x + box.max.x) / 2 // модель может быть не центрирована по оси
  const cy = (box.min.y + box.max.y) / 2
  const width = box.max.x - box.min.x
  const height = box.max.y - box.min.y
  const spread = width * 0.22 // полуразнос пары от продольной оси
  const radius = Math.max(0.4, Math.min(width, height) * 0.16)
  const z = box.max.z
  return [
    { offset: [cx - spread, cy, z], radius },
    { offset: [cx + spread, cy, z], radius },
  ]
}

/**
 * Достаёт из сцены glTF геометрию (в конвенции движка) и родной материал первого меша.
 * Геометрию запекает под трансформ узла, ориентирует и масштабирует; UV и нормали не трогает.
 * Сопла считает из габаритов итоговой геометрии (см. tailNozzles).
 */
function prepareGlbHull(scene: import('three').Object3D, def: GlbHullDef): LoadedHull | null {
  scene.updateMatrixWorld(true)
  let found: Mesh | null = null
  scene.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh && !found) found = m
  })
  if (!found) return null
  const mesh: Mesh = found
  const g = mesh.geometry.clone()
  g.applyMatrix4(mesh.matrixWorld) // узел нёс свой трансформ (масштаб/сдвиг) — запекаем
  // Итог разворота: rollZ ∘ pitchX ∘ yawY ∘ scale. applyMatrix4 правит и нормали — они верны.
  _rotY.makeRotationY(def.yaw)
  _scaleM.makeScale(def.scale, def.scale, def.scale)
  _rotX.makeRotationX(def.pitch)
  _rotZ.makeRotationZ(def.roll)
  g.applyMatrix4(_rotY.premultiply(_scaleM).premultiply(_rotX).premultiply(_rotZ))
  g.computeBoundingSphere()
  g.computeBoundingBox()
  const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material
  matteGlbHull(material)
  // Свои сопла модели, если заданы; иначе — авто из габаритов.
  return { geometry: g, material, nozzles: def.nozzles ?? tailNozzles(g.boundingBox!) }
}

// Грузим ВСЕ GLB-корпуса при импорте модуля (на старте сцены): к открытию верфи готовы.
// Пока не доехал — chassisGeometry падает на процедурную заглушку, материал — на штатный.
const glbCache = new Map<string, LoadedHull>()
for (const def of GLB_HULLS) {
  new GLTFLoader().load(def.url, (gltf) => {
    const hull = prepareGlbHull(gltf.scene, def)
    if (hull) glbCache.set(def.id, hull)
  })
}

/** Геометрия GLB-корпуса, если загрузился; иначе null — вызывающий падает на заглушку. */
function glbGeometry(id: string): BufferGeometry | null {
  return glbCache.get(id)?.geometry ?? null
}

/** Родной материал GLB-корпуса (текстуры Meshy). null, пока не загрузился — откат в hullMaterialFor. */
export function glbMaterial(id: string): Material | null {
  return glbCache.get(id)?.material ?? null
}

/** Сопла GLB-корпуса по id — из габаритов загруженной модели. null, пока не загрузился. */
function glbNozzles(id: string): readonly Nozzle[] | null {
  return glbCache.get(id)?.nozzles ?? null
}

// ─── Шасси → геометрия и сопла ───────────────────────────────────────────────
//
// Данные вместо ветвлений (OCP): новый корпус — новая строка здесь, а не правка
// PlayerShip, чертежа и струй по отдельности. Один источник правды на весь рендер.

let placeholderCache: BufferGeometry | null = null
/**
 * Нейтральная ЗАГЛУШКА на те кадры, пока GLB-меш ещё грузится.
 *
 * Все лётные корпуса теперь — загруженные меши, и подставлять вместо них ЧУЖОЙ корабль
 * (раньше тут стояла процедурная «Аврора») нельзя: на кадр-другой виден не тот борт, да и сам
 * корпус давно снят из игры. Простой ромбик: нос в −Z, размер условный — он живёт доли секунды.
 */
export function placeholderGeometry(): BufferGeometry {
  placeholderCache ??= buildGeometry([
    tri([0, 0, -2], [1, 0, 0], [0, 1, 0], HULL),
    tri([0, 0, -2], [0, 1, 0], [-1, 0, 0], HULL),
    tri([0, 0, -2], [-1, 0, 0], [0, -1, 0], HULL),
    tri([0, 0, -2], [0, -1, 0], [1, 0, 0], HULL),
    tri([0, 0, 2], [0, 1, 0], [1, 0, 0], HULL_DARK),
    tri([0, 0, 2], [-1, 0, 0], [0, 1, 0], HULL_DARK),
    tri([0, 0, 2], [0, -1, 0], [-1, 0, 0], HULL_DARK),
    tri([0, 0, 2], [1, 0, 0], [0, -1, 0], HULL_DARK),
  ])
  return placeholderCache
}

/** Сопла заглушки: пара на корме. Живут те же доли секунды, что и сама заглушка. */
const PLACEHOLDER_NOZZLES: readonly Nozzle[] = [
  { offset: [-0.5, 0, 2], radius: 0.4 },
  { offset: [0.5, 0, 2], radius: 0.4 },
]

/** Геометрия корпуса по id шасси. GLB-корпуса — из реестра; пока не загрузился — заглушка. */
export function chassisGeometry(id: string): BufferGeometry {
  const glb = glbGeometry(id)
  if (glb) return glb
  // Дрон — единственная оставшаяся процедура: он не лётный корпус, а капсула/расходник.
  if (id === 'drone') return droneGeometry()
  return placeholderGeometry() // GLB ещё грузится
}

/** Срезы сопел корпуса по id шасси. GLB-корпуса — из реестра, прочие — процедурные. */
export function chassisNozzles(id: string): readonly Nozzle[] {
  const glb = glbNozzles(id)
  if (glb) return glb
  if (id === 'drone') return DRONE_NOZZLES
  return PLACEHOLDER_NOZZLES // GLB ещё грузится
}
