import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three'
import { BUSH } from '../config'

/**
 * Материалы куста: мыльный пузырь-галактика и неоновое ребро.
 *
 * Пузырь — тонкая переливающаяся плёнка: френель светит по силуэту, центр прозрачен,
 * сквозь него видно насквозь. Никаких текстур — плёнка и перелив считаются в шейдере.
 * Аддитивное смешение: дальние (притушенные туманом) тают сами, ближние наливаются светом.
 *
 * Per-instance идут СВОИ атрибуты `aTint`/`aFog`, а не `instanceColor` three: собственные
 * имена не спорят с встроенным объявлением и держат тон и туман каждого пузыря отдельно.
 */

const BUBBLE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 aTint;
attribute float aFog;

varying vec3 vTint;
varying float vFog;
varying vec2 vUv;

void main() {
  #ifdef USE_INSTANCING
    mat4 im = instanceMatrix;
  #else
    mat4 im = mat4(1.0);
  #endif
  vUv = uv;
  vTint = aTint;
  vFog = aFog;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * im * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`

const BUBBLE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uRim;
uniform float uBase;
uniform float uAlpha;

varying vec3 vTint;
varying float vFog;
varying vec2 vUv;

void main() {
  #include <logdepthbuf_fragment>
  // ПЛОСКИЙ КРУГ (билборд к камере) с РАДИАЛЬНЫМ градиентом: мягкая заливка + светлое кольцо
  // у края. Не 3D-сфера — куст читается как схема галактик, а не как поле мыльных шаров.
  float r = length(vUv - 0.5) * 2.0;
  if (r > 1.0) discard;
  float disc = 1.0 - smoothstep(0.82, 1.0, r);
  float rim = smoothstep(0.45, 0.94, r) * (1.0 - smoothstep(0.94, 1.0, r));
  vec3 col = mix(vTint, vec3(1.0), rim * 0.6);
  float alpha = (uBase * disc + rim * uRim) * vFog * uAlpha;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col, alpha);
}
`

export function bushBubbleMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uRim: { value: 0.95 },
      uBase: { value: 0.14 },
      uAlpha: { value: 1 },
    },
    vertexShader: BUBBLE_VERT,
    fragmentShader: BUBBLE_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
  })
}

/**
 * Неоновое ребро-ЛЕНТА. Линия в WebGL всегда 1px — толщины не имеет, оттого куст казался
 * начерченным иголкой. Потому ребро строится как камеро-ориентированная лента (два ряда
 * вершин по бокам спайна): `aAcross` = −1..+1 поперёк, ядро добела, спад к краям, аддитивно —
 * получается неоновая трубка. `aColor` — вершинный цвет с зашитым туманом: дальние рёбра
 * гаснут вместе с пузырями.
 */
const EDGE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 aColor;
attribute float aAcross;

varying vec3 vCol;
varying float vAcross;

void main() {
  vCol = aColor;
  vAcross = aAcross;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`

const EDGE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uGain;

varying vec3 vCol;
varying float vAcross;

void main() {
  #include <logdepthbuf_fragment>
  // Профиль лампы поперёк ленты: ядро ярче, к краям спадает в ноль.
  float a = abs(vAcross);
  float glow = 1.0 - smoothstep(0.15, 1.0, a);
  vec3 col = mix(vec3(1.0), vCol, smoothstep(0.0, 0.7, a));
  // uGain гасит ВЕСЬ фрагмент, включая белое ядро: иначе аддитив множества трубок и bloom
  // раздувают сердцевину в засвет, а покраска краёв (vCol) на ядро не влияет.
  float alpha = glow * uGain;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col, alpha);
}
`

export function bushEdgeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uGain: { value: 1 } },
    vertexShader: EDGE_VERT,
    fragmentShader: EDGE_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
  })
}

/** Базовый цвет ребра (умножается на туман в вершинный цвет). */
export const BUSH_EDGE_RGB = new Color(BUSH.EDGE_COLOR)
