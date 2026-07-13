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
 * URL карты поверхности по цвету звезды — или `null`, если класса нет среди
 * текстурированных (коричневый/нейтронный/чёрная дыра, а также хардкод-солнце дома).
 * Тогда звезда остаётся на плоском цвете — это штатный фолбэк, а не поломка.
 */
export function starSurfaceUrl(color: number): string | null {
  const id = CLASS_BY_COLOR.get(color)
  return id && TEXTURED.has(id) ? `/stars/star-${id}.webp` : null
}

function configure(texture: Texture): Texture {
  // По долготе карта заворачивается на 360°, поэтому горизонталь ПОВТОРЯЕТСЯ: без
  // этого «кипящее» смещение UV за край дало бы шов. Вертикаль (полюса) — зажата.
  texture.wrapS = RepeatWrapping
  texture.colorSpace = SRGBColorSpace
  return texture
}

/**
 * Грузит карту поверхности звезды по её цвету. Лениво и по одной: в детальном виде
 * всегда ровно одна система, значит и текстур звёзд в кадре — одна-две (двойная).
 * @returns true, если для этого класса карта есть и загрузка пошла.
 */
export function loadStarSurface(color: number, onLoaded: (texture: Texture) => void): boolean {
  const url = starSurfaceUrl(color)
  if (!url) return false
  new TextureLoader().load(
    url,
    (texture) => onLoaded(configure(texture)),
    undefined,
    () => {}, // нет файла — молча остаёмся на плоском цвете
  )
  return true
}

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vDir;

void main() {
  // Направление из центра в СВЯЗАННЫХ осях: по нему берём равнопромежуточную UV,
  // а вращение и «кипение» добавляем в шейдере — геометрия не крутится (физика чиста).
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
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
  gl_FragColor = vec4(texture2D(uMap, vec2(u, v)).rgb, 1.0);
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
