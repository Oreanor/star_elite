import {
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from 'three'
import { STAR_CLASSES } from '@elite/sim'

/**
 * Поверхность звезды: живая плазма на сфере, а не плоский диск.
 *
 * Диск раньше был одним цветом (`starMaterial`, MeshBasicMaterial). Теперь на
 * ближнюю звезду ложится равнопромежуточная (2:1) карта её КЛАССА — грануляция,
 * пятна, корональные жилы, — и медленно вращается и «кипит» прямо в шейдере: ноль
 * вершинной анимации, ноль аллокаций в кадре, только растущее `uTime`.
 *
 * Цвет остаётся в конфиге (`STAR_CLASSES.color`) единственным источником правды:
 * он красит СВЕТ, корону и дальнюю точку, а до загрузки карты — и сам диск (фолбэк
 * на плоский материал). Текстуры уже цветные по классу, поэтому шейдер их не тинтует.
 */

/** Цвет класса → его буква. Цвета уникальны, так что обратная связь однозначна. */
const CLASS_BY_COLOR = new Map<number, string>(STAR_CLASSES.map((c) => [c.color, c.id]))

/** Только у звёзд главной последовательности есть карта; T/N/чёрная дыра — плоский цвет. */
const TEXTURED = new Set(['O', 'B', 'A', 'F', 'G', 'K', 'M'])

/**
 * `full` — система вблизи (1774×887); `lo` — галактика / HUD (512×256, см. scripts/star-lo.mjs).
 */
export type StarSurfaceQuality = 'full' | 'lo'

/**
 * URL карты поверхности по цвету звезды — или `null`, если класса нет среди
 * текстурированных (коричневый/нейтронный/чёрная дыра, а также хардкод-солнце дома).
 * Тогда звезда остаётся на плоском цвете — это штатный фолбэк, а не поломка.
 */
export function starSurfaceUrl(
  color: number,
  quality: StarSurfaceQuality = 'full',
): string | null {
  const id = CLASS_BY_COLOR.get(color)
  if (!id || !TEXTURED.has(id)) return null
  return quality === 'lo' ? `/stars/lo/star-${id}.webp` : `/stars/star-${id}.webp`
}

function cacheKey(color: number, quality: StarSurfaceQuality): string {
  return `${quality}:${color}`
}

function configure(texture: Texture, quality: StarSurfaceQuality): Texture {
  // По долготе карта заворачивается на 360°, поэтому горизонталь ПОВТОРЯЕТСЯ: без
  // этого «кипящее» смещение UV за край дало бы шов. Вертикаль (полюса) — зажата.
  texture.wrapS = RepeatWrapping
  texture.colorSpace = SRGBColorSpace
  // lo — мелкий LOD галактики; full — лимб вблизи, анизотропия нужна.
  texture.anisotropy = quality === 'lo' ? 1 : 16
  return texture
}

/** Кэш карт: full (Bodies) и lo (галактика) живут раздельно. */
const surfaceCache = new Map<string, Texture>()
const surfaceLoading = new Set<string>()

/**
 * Грузит карту поверхности звезды по её цвету.
 * @returns true, если для этого класса карта есть и загрузка пошла / уже в кэше.
 */
export function loadStarSurface(
  color: number,
  onLoaded: (texture: Texture) => void,
  quality: StarSurfaceQuality = 'full',
): boolean {
  const key = cacheKey(color, quality)
  const cached = surfaceCache.get(key)
  if (cached) {
    onLoaded(cached)
    return true
  }
  const url = starSurfaceUrl(color, quality)
  if (!url) return false
  if (surfaceLoading.has(key)) return true
  surfaceLoading.add(key)
  new TextureLoader().load(
    url,
    (texture) => {
      const ready = configure(texture, quality)
      surfaceCache.set(key, ready)
      surfaceLoading.delete(key)
      onLoaded(ready)
    },
    undefined,
    () => {
      surfaceLoading.delete(key) // нет файла — молча остаёмся на плоском цвете
    },
  )
  return true
}

/** Уже загруженная lo-карта (синхронно) — для галактического LOD без колбэка в кадре. */
export function starSurfaceTexture(
  color: number,
  quality: StarSurfaceQuality = 'lo',
): Texture | null {
  return surfaceCache.get(cacheKey(color, quality)) ?? null
}

/**
 * Прогрев lo-карт главной последовательности: на галактическом слое ближайшие
 * звёзды разных классов могут смениться за кадр — ждать каждую нельзя.
 */
export function preloadStarSurfaces(onReady?: () => void): void {
  for (const c of STAR_CLASSES) {
    if (!TEXTURED.has(c.id)) continue
    loadStarSurface(c.color, () => onReady?.(), 'lo')
  }
}

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vDir;
varying vec3 vNormalV; // нормаль в осях камеры — для лимбового свечения у края диска
varying vec3 vViewV;   // направление на камеру

void main() {
  // Направление из центра в СВЯЗАННЫХ осях: по нему берём равнопромежуточную UV,
  // а вращение и «кипение» добавляем в шейдере — геометрия не крутится (физика чиста).
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Для сферы направление из центра И есть нормаль. У края диска нормаль смотрит вбок
  // от камеры — там и зажигаем лимб, чтобы переход диск→космос был не резким срезом.
  vNormalV = normalize(normalMatrix * position);
  vViewV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform sampler2D uMap;
uniform float uTime;

varying vec3 vDir;
varying vec3 vNormalV;
varying vec3 vViewV;

const float INV_TAU = 0.15915494; // 1/(2π)
const float INV_PI = 0.31830989;  // 1/π

void main() {
  #include <logdepthbuf_fragment>

  vec3 d = normalize(vDir);

  // Медленное собственное вращение вокруг оси Y — звезда живёт, а не стоит слайдом.
  float a = uTime * 0.02;
  float ca = cos(a), sa = sin(a);
  vec3 ds = vec3(ca * d.x - sa * d.z, d.y, sa * d.x + ca * d.z);

  float u = atan(ds.z, ds.x) * INV_TAU + 0.5;
  float v = asin(clamp(ds.y, -1.0, 1.0)) * INV_PI + 0.5;

  // «Кипение»: лёгкое доменное искажение UV встречными синусами — плазма течёт,
  // цикл не читается. Амплитуда мала, чтобы полюса не защемляло, а шов не всплывал.
  float boil = 0.012;
  u += boil * sin(v * 16.0 + uTime * 0.6);
  v += boil * 0.5 * sin(u * 20.0 - uTime * 0.5);

  // Карта уже цветная по классу — не тинтуем, отдаём как есть. Свечение звезды
  // не зависит от света сцены: это сам источник, поэтому материал неосвещённый.
  vec3 col = texture2D(uMap, vec2(u, v)).rgb;

  // Лимбовое свечение: у края диска нормаль почти перпендикулярна взгляду (facing→0),
  // там плотнее и ярче — диск не срезается резко, а сливается с узкой короной.
  float facing = clamp(dot(normalize(vNormalV), normalize(vViewV)), 0.0, 1.0);
  float limb = pow(1.0 - facing, 2.5);
  col *= 1.0 + limb * 1.3;

  gl_FragColor = vec4(col, 1.0);
}
`

/**
 * Материал поверхности одной звезды. Свой на каждую текстуру: `uMap` у классов
 * разный, а `uTime` двигает сцена в кадре. Непрозрачный, пишет глубину — планета,
 * зашедшая перед звездой, обязана её закрыть.
 */
export function createStarSurfaceMaterial(map: Texture): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uMap: { value: map },
      uTime: { value: 0 },
    },
    fog: false,
  })
}

/** Материалы галактического LOD — только lo-карты. Bodies держит свои материалы. */
const loMaterialCache = new Map<number, ShaderMaterial>()

export function starSurfaceMaterial(color: number): ShaderMaterial | null {
  const map = starSurfaceTexture(color, 'lo')
  if (!map) return null
  let mat = loMaterialCache.get(color)
  if (!mat) {
    mat = createStarSurfaceMaterial(map)
    loMaterialCache.set(color, mat)
  }
  return mat
}

/** Крутит кипение у lo-материалов галактического LOD. */
export function tickStarSurfaceTime(time: number): void {
  for (const mat of loMaterialCache.values()) mat.uniforms.uTime!.value = time
}
