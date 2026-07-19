import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  LineBasicMaterial,
  type Material,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PointsMaterial,
  ShaderMaterial,
  SpriteMaterial,
  type Texture,
} from 'three'
import { MATERIAL, PALETTE } from '../config'
import { glbMaterial } from '../geometry/ships'

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
 * Корпуса кораблей. `DoubleSide`: модели не строго замкнуты (крылья, кили, тонкие
 * плоскости — грани в один слой), и отсечение задних граней оставляло в них дыры —
 * корпус «глючил» даже на дефолтном масштабе. Задние грани показываем.
 *
 * Пробное `FrontSide` заводили ради мерцания корпуса на ГИГАНТСКОМ масштабе
 * (миелофон ×тысячи), но оно ломало обычные модели, а мерцание там всё равно упирается
 * в лог-буфер глубины — лечится не отсечением граней, а `GIANT_RENDER_CAP`.
 */
export function hullMaterial(): MeshStandardMaterial {
  if (hull) return hull
  hull = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    side: DoubleSide,
    metalness: MATERIAL.HULL_METALNESS,
    roughness: MATERIAL.HULL_ROUGHNESS,
  })
  // Перламутровый френель-кант: холодный ободок на косом угле поверх штатного PBR.
  // Правим готовый шейдер MeshStandard, а не пишем свой: сохраняем весь свет, тени и
  // блик от звезды, добавляя лишь один член. `normal` и `vViewPosition` живут в scope
  // до конца main(); с flatShading `normal` — нормаль ФАСКИ, поэтому кант гранёный.
  hull.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: new Color(MATERIAL.HULL_RIM_COLOR) }
    shader.uniforms.uRimStrength = { value: MATERIAL.HULL_RIM_STRENGTH }
    shader.uniforms.uRimPower = { value: MATERIAL.HULL_RIM_POWER }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec3 uRimColor;
         uniform float uRimStrength;
         uniform float uRimPower;
         void main() {`,
      )
      .replace(
        '#include <dithering_fragment>',
        `float rimFresnel = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uRimPower);
         gl_FragColor.rgb += uRimColor * (rimFresnel * uRimStrength);
         #include <dithering_fragment>`,
      )
  }
  return hull
}

/**
 * Материал корпуса по id шасси. GLB-корпуса несут СВОЙ материал с текстурами (карты Meshy) —
 * берём его; пока GLB не доехал, откат на штатный металл (в это время и геометрия — заглушка,
 * см. chassisGeometry). Процедурные корпуса — штатный `hullMaterial`. Один источник — реестр
 * GLB_HULLS в ships.ts, без ветвления по каждому id.
 */
export function hullMaterialFor(chassisId: string): Material {
  return glbMaterial(chassisId) ?? hullMaterial()
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
    metalness: MATERIAL.STATION_METALNESS,
    roughness: MATERIAL.STATION_ROUGHNESS,
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
  // Белый базовый цвет: тон и затухание каждого взрыва (жар→тьма) приходят инстансным
  // цветом (setColorAt), поэтому вспышки гаснут ПО ОТДЕЛЬНОСТИ одним аддитивным материалом,
  // а не всей пачкой разом. Ядро и осколки делят его — оба лишь светящаяся масса.
  explosion ??= new MeshBasicMaterial({
    color: 0xffffff,
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

let muzzleTex: CanvasTexture | null = null

/**
 * Текстура ДУЛЬНОЙ ВСПЫШКИ — «шаровая молния»: раскалённое добела ядро с резким пиком в
 * центре и быстрым спадом в цветной ореол. Не низкополигональный икосаэдр (тот читался
 * гранёным шестиугольником), а радиальный градиент на камеро-ориентированном квадрате —
 * шарик КРУГЛЫЙ с любого угла. Ядро выжжено в единицу: вспышка обязана быть яркой.
 */
function muzzleFlashTexture(): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  // Плоское раскалённое ядро (до 22%), затем крутой спад — плотный яркий шар, а не мягкое пятно.
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.22, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)')
  g.addColorStop(0.78, 'rgba(255,255,255,0.08)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new CanvasTexture(canvas)
}

let muzzleFlash: MeshBasicMaterial | null = null

/**
 * Дульная вспышка. Как вспышка поля — свет, а не тело: аддитивно, без записи глубины.
 * Базовый белый домножается инстансным цветом (тон по классу × затухание), карта — горячий
 * радиальный градиент: круглый плотный шар с выжженным центром. Один вызов на все стволы.
 */
export function muzzleFlashMaterial(): MeshBasicMaterial {
  muzzleTex ??= muzzleFlashTexture()
  muzzleFlash ??= new MeshBasicMaterial({
    color: 0xffffff,
    map: muzzleTex,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    // Тест глубины ВЫКЛ: шар сидит у самого среза ствола, вплотную к обшивке — с обычным
    // тестом корпус его перекрывал, и вспышки «не было видно вообще». Аддитив поверх всего.
    depthTest: false,
    fog: false,
  })
  return muzzleFlash
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
  // Интенсивнее к краю, внутрь градиент быстро гаснет почти в прозрачность — как
  // френель у сферы: кромка плотная, середина сквозная, но не жёстко полая.
  g.addColorStop(0.0, 'rgba(255,255,255,0.04)') // центр почти прозрачный (корабль виден)
  g.addColorStop(0.5, 'rgba(255,255,255,0.1)')
  g.addColorStop(0.8, 'rgba(255,255,255,0.42)')
  g.addColorStop(0.92, 'rgba(255,255,255,0.9)') // ярче всего у самого края
  g.addColorStop(1.0, 'rgba(255,255,255,0)') // мягкий спад к самой кромке
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

let dustLaser: LineBasicMaterial | null = null

/**
 * Тот же отрезок, но АДДИТИВНЫЙ и яркий: на глубоком крейсерском ходу (десятки млн ×)
 * пыль загорается лазерными линиями. Цвет и непрозрачность правит кадр по накалу.
 * Отдельный материал, чтобы не переключать blending на общем каждый кадр (рекомпиляция).
 */
export function dustLaserMaterial(): LineBasicMaterial {
  dustLaser ??= new LineBasicMaterial({
    color: 0xbfe6ff,
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
  return dustLaser
}

let dustNeon: ShaderMaterial | null = null

/**
 * ЖИРНАЯ неоновая пыль на глубоком форсаже. Линия толщины в WebGL не имеет (см. трассеры-
 * цилиндры), поэтому на большом накале штрих рисуется камеро-ориентированной ЛЕНТОЙ-квадом —
 * у неё есть ширина, и мимо несутся светящиеся трубки, а не иголки.
 *
 * Но голый квад читается острой стеклянной щепкой: у него жёсткая кромка. Поэтому пламя
 * РАЗМАЗАНО в шейдере, а не нарисовано геометрией: поперёк ленты (uv.x −1..1) свет гаснет
 * гауссом до нуля к краю, вдоль (uv.y 0=голова→1=хвост) — тает к хвосту, и по длине бежит
 * лёгкий рипл. Ядро выбелено, края держат цвет — так штрих светится трубкой, а не гранью.
 * Аддитивно, без записи глубины: это свет, а не тело. `uOpacity`/`uTime` правит кадр.
 */
export function dustNeonMaterial(): ShaderMaterial {
  dustNeon ??= new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(0xbfe6ff) },
      uOpacity: { value: 0.9 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        // Поперёк ленты: гаусс от оси к краям — мягкое ядро без жёсткой кромки.
        float across = exp(-vUv.x * vUv.x * 3.5);
        // Вдоль: ярко у головы (там сама пылинка), плавно в ноль к хвосту.
        float along = 1.0 - smoothstep(0.15, 1.0, vUv.y);
        // Рипл бежит от головы к хвосту — пламя живое, а не залитая полоса.
        float ripple = 0.78 + 0.22 * sin(vUv.y * 18.0 - uTime * 9.0);
        float a = across * along * ripple * uOpacity;
        // Ядро выбелено, края держат неон — объём трубки, а не плоский цвет.
        vec3 col = mix(uColor, vec3(1.0), across * across * 0.7);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  })
  return dustNeon
}

let crossRays: MeshBasicMaterial | null = null

/** Лучи из концов креста: аддитивные, глубину не пишут — свет складывается с фоном. */
export function crossRayMaterial(): MeshBasicMaterial {
  crossRays ??= new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
  return crossRays
}

let crossWire: LineBasicMaterial | null = null

/** Каркас креста (неон). Портал-грани — `crossPortal.ts`. */
export function crossWireMaterial(): LineBasicMaterial {
  crossWire ??= new LineBasicMaterial({
    color: 0xa8f4ff,
    transparent: true,
    opacity: 1,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
  return crossWire
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
