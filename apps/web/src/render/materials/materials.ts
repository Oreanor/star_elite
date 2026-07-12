import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PointsMaterial,
  SpriteMaterial,
  type Texture,
} from 'three'
import { MATERIAL, PALETTE } from '../config'

/**
 * Материалы создаются один раз на модуль. Каждый новый материал — это новая
 * компиляция шейдера и новый draw call; в кадре их создавать нельзя.
 *
 * Везде `flatShading` и `vertexColors`: гранёность и покраска — свойства геометрии,
 * а не постобработки.
 *
 * Корпуса — `MeshStandard`: у металла обязан быть блик, иначе гранёность не читается,
 * а корабль превращается в плоскую аппликацию. Отражает он `scene.environment` —
 * то самое небо, что стоит фоном (см. Sky.tsx). Планеты, камни и пыль остались
 * на `Lambert`: они не металл, а PBR стоит заметно дороже — платим только там,
 * где это видно.
 */

let hull: MeshStandardMaterial | null = null

/**
 * Корпуса кораблей. `DoubleSide` намеренно: корпуса собраны вручную из
 * треугольников, и следить за обходом вершин у каждой грани — источник
 * невидимых дыр. На двух сотнях треугольников цена нулевая, а грань,
 * повёрнутая наизнанку, всё равно освещается верно.
 */
export function hullMaterial(): MeshStandardMaterial {
  hull ??= new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    side: DoubleSide,
    metalness: MATERIAL.HULL_METALNESS,
    roughness: MATERIAL.HULL_ROUGHNESS,
  })
  return hull
}

let rock: MeshLambertMaterial | null = null

/** Астероиды выпуклы, обход правильный — обратные грани можно отсекать. */
export function rockMaterial(): MeshLambertMaterial {
  rock ??= new MeshLambertMaterial({ vertexColors: true, flatShading: true })
  return rock
}

const texturedRocks = new Map<Texture, MeshLambertMaterial>()

/**
 * Камень с картой. Материал на текстуру, а не на камень: текстур пять, камней сотни.
 *
 * `flatShading` остаётся: гранёность — следствие восьмидесяти граней, а текстура
 * лишь заполняет их щебнем. Покраска по вершинам выключена — она множилась бы
 * на фотографию и топила её в темноте.
 */
export function rockTexturedMaterial(map: Texture): MeshLambertMaterial {
  let material = texturedRocks.get(map)
  if (!material) {
    material = new MeshLambertMaterial({ map, flatShading: true })
    texturedRocks.set(map, material)
  }
  return material
}

let cloak: MeshBasicMaterial | null = null

/**
 * Корабль под маскировочным полем. Не металл, а дыра в кадре: свет он не
 * отражает вовсе, поэтому материал не участвует в освещении (`MeshBasic`).
 *
 * Не чёрный намертво: сквозь поле чуть просвечивают звёзды. Полностью
 * непрозрачный силуэт читался бы как ошибка отрисовки, а не как невидимка,
 * и пилот перестал бы понимать, где его собственный нос.
 */
export function cloakMaterial(): MeshBasicMaterial {
  cloak ??= new MeshBasicMaterial({ color: 0x05070b, transparent: true, opacity: 0.72, side: DoubleSide })
  return cloak
}

let corridor: MeshBasicMaterial | null = null

/**
 * Направляющие стыковочного коридора. Светятся сами: это не металл, а огни.
 *
 * Аддитивно и без записи глубины — кольцо не должно ни затенять станцию, ни
 * перекрывать корабль, сквозь который пролетает. Яркость каждого кольца
 * приходит инстансным цветом: по ряду бежит волна к причалу, и она же говорит,
 * куда лететь. Материал об этом не знает — он просто множит.
 */
export function corridorMaterial(): MeshBasicMaterial {
  corridor ??= new MeshBasicMaterial({
    color: 0xffffff,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  return corridor
}

let planet: MeshLambertMaterial | null = null

/**
 * Планета без текстуры. НЕ `flatShading`: гранёный шар в тысячи километров
 * читается как ошибка, а не как стиль. Нормали гладкие, цвет — по вершинам.
 */
export function planetMaterial(): MeshLambertMaterial {
  planet ??= new MeshLambertMaterial({ vertexColors: true })
  return planet
}

let moon: MeshLambertMaterial | null = null

/**
 * Мелкая луна. Тоже НЕ `flatShading` — по той же причине, что и планета.
 *
 * Ни карты, ни покраски по вершинам: оттенок каждой приходит инстансным цветом,
 * а `MeshLambert` его домножает на свой белый `color`. Один материал на все луны
 * галактики — один вызов отрисовки на систему.
 */
export function moonMaterial(): MeshLambertMaterial {
  moon ??= new MeshLambertMaterial({ color: 0xffffff })
  return moon
}

const texturedPlanets = new Map<Texture, MeshLambertMaterial>()

/** Планета с картой. Материал на текстуру, а не на планету: их единицы. */
export function planetTexturedMaterial(map: Texture): MeshLambertMaterial {
  let material = texturedPlanets.get(map)
  if (!material) {
    material = new MeshLambertMaterial({ map })
    texturedPlanets.set(map, material)
  }
  return material
}

let station: MeshStandardMaterial | null = null

/**
 * Станция — тоже металл, но крупный и потёртый: блик мягче корабельного.
 *
 * `DoubleSide` по той же причине, что и у корпусов: тор, спицы и горловина
 * причала собраны вручную из треугольников, и следить за обходом вершин у каждой
 * грани — верный способ получить невидимые дыры. На пяти сотнях треугольников
 * цена нулевая, а изнанка причального зева обязана быть видна: в него влетают.
 */
export function stationMaterial(): MeshStandardMaterial {
  station ??= new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    side: DoubleSide,
    metalness: 0.4,
    roughness: 0.6,
  })
  return station
}

const coronas = new Map<number, SpriteMaterial>()

/**
 * Корона звезды. Аддитивная и без записи глубины: свечение ничего не заслоняет,
 * оно складывается с тем, что за ним. Цвет берётся от самой звезды.
 */
export function coronaMaterial(map: Texture, color: number): SpriteMaterial {
  let material = coronas.get(color)
  if (!material) {
    material = new SpriteMaterial({
      map,
      color: new Color(color),
      transparent: true,
      blending: AdditiveBlending,
      // Глубину не пишет, но проверяет: планета, вставшая между тобой и звездой,
      // обязана закрыть ореол — иначе он читается как наклейка на объективе.
      depthWrite: false,
      fog: false,
    })
    coronas.set(color, material)
  }
  return material
}

const starDiscs = new Map<number, MeshBasicMaterial>()

/**
 * Звезда светится сама: освещать источник света бессмысленно.
 *
 * Кэш по ЦВЕТУ, а не одиночка: одиночка приняла бы `color` от первой звезды и
 * молча выбросила у всех следующих. Систем в галактике много, и красная звезда
 * соседней светила бы жёлтым — из-за `??=`, а не из-за данных.
 */
export function starMaterial(color: number): MeshBasicMaterial {
  let material = starDiscs.get(color)
  if (!material) {
    material = new MeshBasicMaterial({ color: new Color(color), fog: false })
    starDiscs.set(color, material)
  }
  return material
}

let dysonPanels: MeshBasicMaterial | null = null
let dysonLines: LineBasicMaterial | null = null

/**
 * Сфера Дайсона. Не металл и не освещается: свет звезды бьёт в неё изнутри, а
 * снаружи она — тёмная решётка на фоне короны. Полупрозрачна, чтобы сквозь
 * каркас просвечивало светило, и не пишет глубину — иначе гасила бы собственную
 * звезду. Панели рисуются гранями, каркас — линиями: у них разные материалы.
 */
export function dysonPanelMaterial(): MeshBasicMaterial {
  dysonPanels ??= new MeshBasicMaterial({
    color: 0x1c2836,
    transparent: true,
    opacity: 0.72,
    side: DoubleSide,
    depthWrite: false,
    fog: false,
  })
  return dysonPanels
}

export function dysonLineMaterial(): LineBasicMaterial {
  dysonLines ??= new LineBasicMaterial({
    color: 0x2a3a4c,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: false,
  })
  return dysonLines
}

let pod: MeshLambertMaterial | null = null

export function podMaterial(): MeshLambertMaterial {
  pod ??= new MeshLambertMaterial({ color: PALETTE.POD, flatShading: true })
  return pod
}

let missile: MeshStandardMaterial | null = null

export function missileMaterial(): MeshStandardMaterial {
  missile ??= new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 0.5,
    roughness: 0.45,
  })
  return missile
}

let explosion: MeshBasicMaterial | null = null

export function explosionMaterial(): MeshBasicMaterial {
  explosion ??= new MeshBasicMaterial({
    color: PALETTE.EXPLOSION,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
  return explosion
}

let warpFlash: MeshBasicMaterial | null = null

/**
 * Вспышка гиперперехода. Свет, а не тело: аддитивно и без записи глубины, как взрыв.
 * Цвет — белый: тон и яркость каждой вспышки приходят инстансным цветом (`instanceColor`),
 * материал их только домножает. Один материал на все прыжки — один вызов отрисовки.
 */
export function warpFlashMaterial(): MeshBasicMaterial {
  warpFlash ??= new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
  return warpFlash
}

let shieldFlash: MeshBasicMaterial | null = null

/**
 * Мягкий радиальный градиент «пятна поля»: белый центр, гаснущий к краю в прозрачность.
 * Строится в canvas один раз. Аддитивная отрисовка домножает на него цвет вспышки,
 * поэтому вместо резкого кружка получается размытый ореол — «участок купола проявился».
 */
function shieldGradientTexture(): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  // Ядро не в полную силу — вспышка и так аддитивная; резкий белый центр «выжигал» бы точку.
  g.addColorStop(0, 'rgba(255,255,255,0.85)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)')
  g.addColorStop(0.7, 'rgba(255,255,255,0.08)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new CanvasTexture(canvas)
}

/**
 * Вспышка защитного поля станции. Как варп-вспышка — свет, а не тело: аддитивно, без
 * записи глубины. Базовый цвет белый и домножается инстансным (голубой фосфор × яркость ×
 * спад), поэтому все вспышки идут одним вызовом отрисовки и гаснут по отдельности. Карта —
 * радиальный градиент: пятно мягкое и прозрачное к краю, а не плоский кружок.
 */
export function shieldFlashMaterial(): MeshBasicMaterial {
  shieldFlash ??= new MeshBasicMaterial({
    color: 0xffffff,
    map: shieldGradientTexture(),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
  return shieldFlash
}

/**
 * Текстура-КОЛЬЦО для щита корабля: центр полый (корабль виден насквозь), ближе к краю
 * загорается ободок и мягко гаснет. В отличие от диска станции это не пятно, а окружность
 * вокруг силуэта — «поле обвело корабль». Аддитив, поэтому центр в ноль = ничего не портит.
 */
let shieldRing: CanvasTexture | null = null
function shieldRingTexture(): CanvasTexture {
  if (shieldRing) return shieldRing
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0.0, 'rgba(255,255,255,0)') // полый центр: корабль виден
  g.addColorStop(0.55, 'rgba(255,255,255,0)')
  g.addColorStop(0.78, 'rgba(255,255,255,0.75)') // ободок
  g.addColorStop(0.9, 'rgba(255,255,255,0.35)')
  g.addColorStop(1.0, 'rgba(255,255,255,0)') // мягко в ноль к самому краю
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  shieldRing = new CanvasTexture(canvas)
  return shieldRing
}

let shieldBubble: MeshBasicMaterial | null = null

/**
 * Защитное поле корабля — плоский КРУЖОК, развёрнутый к камере (billboard в компоненте).
 * Со всех сторон читается одинаковой окружностью, окружающей корабль, — и не гранёная 3D-сфера,
 * что вблизи выглядела многоугольником. Встроенный MeshBasicMaterial сам пишет log-depth,
 * поэтому виден на любой дистанции (у сферы был рукописный шейдер, ронявший глубину вдали).
 *
 * Двусторонний: как бы billboard ни повернулся, кольцо не исчезнет изнанкой. Базовый цвет
 * белый и домножается инстансным (голубой фосфор × спад) — все кружки одним вызовом.
 */
export function shieldBubbleMaterial(): MeshBasicMaterial {
  shieldBubble ??= new MeshBasicMaterial({
    color: 0xffffff,
    map: shieldRingTexture(),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  })
  return shieldBubble
}

const tracers = new Map<string, MeshBasicMaterial>()

/**
 * Материал болта. Ключ — цвет и прозрачность: сколько разных лазеров в бою,
 * столько материалов, и ни одним больше. Создаются один раз на модуль.
 *
 * `MeshBasicMaterial`, а не `LineBasicMaterial`: болт стал цилиндром, потому что
 * толщину линии WebGL не поддерживает.
 */
export function tracerMaterial(color: number, opacity: number): MeshBasicMaterial {
  const key = `${color}:${opacity}`
  let material = tracers.get(key)
  if (!material) {
    material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
    tracers.set(key, material)
  }
  return material
}

let dust: LineBasicMaterial | null = null

/** Пыль рисуется отрезками: на крейсере они вытягиваются в штрихи. */
export function dustMaterial(): LineBasicMaterial {
  dust ??= new LineBasicMaterial({
    color: 0xb9c6d4,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    fog: false,
  })
  return dust
}

let stars: PointsMaterial | null = null

export function starfieldMaterial(size: number): PointsMaterial {
  stars ??= new PointsMaterial({
    color: 0xffffff,
    size,
    // Далёкие звёзды не должны уменьшаться с расстоянием — они бесконечно далеко.
    sizeAttenuation: false,
    depthWrite: false,
    fog: false,
  })
  return stars
}

let cockpit: MeshStandardMaterial | null = null

export function cockpitMaterial(): MeshStandardMaterial {
  cockpit ??= new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    side: DoubleSide,
    metalness: MATERIAL.HULL_METALNESS,
    roughness: MATERIAL.HULL_ROUGHNESS,
  })
  return cockpit
}

let tractor: LineBasicMaterial | null = null

/** Луч захвата. Аддитивный и без записи глубины: это свет, а не трос. */
export function tractorMaterial(): LineBasicMaterial {
  tractor ??= new LineBasicMaterial({
    color: PALETTE.TRACTOR,
    transparent: true,
    opacity: 0.55,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
  return tractor
}
