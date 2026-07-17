import { DoubleSide, ShaderMaterial } from 'three'

/**
 * Материал станции-КРЕСТА — «бог в центре вселенной».
 *
 * Не простой металл: он ПРЕЛОМЛЯЕТСЯ, как в кривых зеркалах, и оттого кажется не вполне
 * реальным. Делают это две вещи, обе — чистый шейдер, без постобработки и лишних вызовов:
 *
 *  1. ВАРП ВЕРШИН. Каждую вершину медленно ведёт по нескольким несоизмеримым синусам от её
 *     же положения и времени — силуэт колышется, «плывёт», как отражение в неспокойной ртути.
 *     Несоизмеримые частоты не дают периода, потому движение не читается циклом.
 *  2. ФРЕНЕЛЬ + поток энергии. К кромкам (взгляд вскользь) крест раскаляется добела-в-золото,
 *     а по телу бегут светящиеся полосы — божественное свечение, а не ровная заливка.
 *
 * Покраска граней (vertexColors) остаётся базой — крест читается как конструкция, — а
 * свечение и варп ложатся поверх. Лог-буфер глубины обязателен: крест стоит в кадре рядом
 * со звездой-гигантом.
 */

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uTime;
uniform float uWarp;

varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec3 vLocal;

void main() {
  vColor = color;
  vLocal = position;

  // ВАРП: смещаем вершину поперечными синусами её же координат и времени. Низкие частоты
  // (силуэт плывёт целиком, а не дрожит зубцами) и разные фазы по осям — «кривое зеркало».
  vec3 p = position;
  float w = uWarp;
  p.x += sin(position.y * 3.1 + uTime * 0.9) * w + sin(position.z * 2.3 - uTime * 0.6) * w * 0.6;
  p.y += sin(position.z * 2.7 + uTime * 0.7) * w + sin(position.x * 3.3 - uTime * 0.8) * w * 0.6;
  p.z += sin(position.x * 2.5 + uTime * 0.5) * w * 0.5;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uTime;

varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec3 vLocal;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  #include <logdepthbuf_fragment>

  // Френель: к кромке (нормаль перпендикулярна взгляду) крест раскаляется добела.
  float facing = clamp(dot(normalize(vNormalV), normalize(vViewV)), 0.0, 1.0);
  float fresnel = pow(1.0 - facing, 3.0);

  // ГЛАДКАЯ ПЛАЗМА: медленный текучий fbm с домейн-варпом. Координата собрана из всех трёх
  // осей, чтобы плазма покрывала каждую балку. Не разряды — плавные перетекающие сгустки.
  vec2 uv = vec2(vLocal.x * 3.5 + vLocal.z * 2.0, vLocal.y * 3.5 - vLocal.z * 2.0);
  float t = uTime * 0.12;
  vec2 w = vec2(fbm(uv * 0.8 + t), fbm(uv * 0.8 + 7.3 - t));
  float n = fbm(uv + w * 1.6);
  float pulse = 0.85 + 0.15 * sin(uTime * 1.4);

  // Бело-голубой градиент: тело голубое, гребни плазмы уходят добела — светится как звезда.
  vec3 cold = vec3(0.10, 0.42, 1.0);
  vec3 hot = vec3(0.80, 0.92, 1.0);
  vec3 plasma = mix(cold, hot, smoothstep(0.35, 0.9, n));

  vec3 col = plasma * (0.85 + 0.9 * n) * pulse;
  col += vec3(0.85, 0.93, 1.0) * fresnel * 1.4; // добела на самой кромке
  gl_FragColor = vec4(col, 1.0);
}
`

/** Материал креста. `uTime` двигает сцена в кадре; `uWarp` — амплитуда «кривого зеркала». */
export function createDivineCrossMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uTime: { value: 0 },
      // Амплитуда варпа в ЕДИНИЧНОЙ геометрии (крест масштабируется мешем). ~1.5% силуэта:
      // плывёт заметно, но крест не разваливается.
      uWarp: { value: 0.015 },
    },
    vertexColors: true,
    side: DoubleSide,
    fog: false,
  })
}
