import { Color, DoubleSide, ShaderMaterial } from 'three'

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
uniform vec3 uHalo;

varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec3 vLocal;

void main() {
  #include <logdepthbuf_fragment>

  // Френель: к кромке (нормаль перпендикулярна взгляду) крест раскаляется — святой ореол края.
  float facing = clamp(dot(normalize(vNormalV), normalize(vViewV)), 0.0, 1.0);
  float fresnel = pow(1.0 - facing, 3.0);

  // Поток энергии по телу: несколько бегущих полос вдоль осей, пульсирующих во времени.
  float flow =
    0.5 + 0.5 * sin(vLocal.z * 16.0 - uTime * 2.2) *
                sin(vLocal.x * 9.0 + uTime * 1.3);
  float pulse = 0.7 + 0.3 * sin(uTime * 1.6);

  // База — покраска граней; поверх золото-белое свечение по френелю и потоку.
  vec3 col = vColor;
  col += uHalo * (fresnel * 1.8 + flow * 0.35) * pulse;
  col += uHalo * fresnel * fresnel * 1.2; // добела на самой кромке

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
      // Золото-белый ореол — «божественный» тон свечения.
      uHalo: { value: new Color(0xfff0c8) },
    },
    vertexColors: true,
    side: DoubleSide,
    fog: false,
  })
}
