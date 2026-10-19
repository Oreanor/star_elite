import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three'
import { TORUS } from '../config'

/**
 * Материалы гипертора: галактика-ПУФ (мягкое туманное облачко) и ребро-ДОТ (нить точек).
 *
 * Оба намеренно скупы на свет: узлов и точек в кадре сотни, а сцена идёт через bloom —
 * жирный аддитив мгновенно выгорает в белое. Пуф — гаусс без ободка, точка — мягкий круг.
 */

/** Галактика — билборд-квад с гауссовым спадом. Ни ободка, ни диска: просто дымка. */
const PUFF_VERT = /* glsl */ `
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

const PUFF_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uGain;

varying vec3 vTint;
varying float vFog;
varying vec2 vUv;

void main() {
  #include <logdepthbuf_fragment>
  // Плотное ядро + короткое гало: узкий гаусс даёт чёткую «звёздочку», а не размазанное пятно.
  float r = length(vUv - 0.5) * 2.0;
  if (r > 1.0) discard;
  float core = exp(-r * r * 16.0);     // тугое ядро — видно, ГДЕ галактика
  float halo = exp(-r * r * 3.0) * 0.35; // слабое гало вокруг
  float puff = core + halo;
  vec3 col = mix(vTint, vec3(1.0), core * 0.6); // сердцевина светлее — читается точкой
  float alpha = puff * vFog * uGain;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col, alpha);
}
`

export function torusPuffMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uGain: { value: TORUS.PUFF_INTENSITY } },
    vertexShader: PUFF_VERT,
    fragmentShader: PUFF_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
  })
}

/** Ребро — облако ТОЧЕК вдоль дуги. Каждая точка — мягкий круг, яркость несёт `aBright`. */
const DOT_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute float aBright;

uniform float uSize;

varying float vBright;

void main() {
  vBright = aBright;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Точка немного уменьшается с дальностью, но не исчезает: делитель зажат снизу.
  gl_PointSize = uSize * (300.0 / max(1.0, -mv.z));
  #include <logdepthbuf_vertex>
}
`

const DOT_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uNear;
uniform vec3 uFar;
uniform float uGain;

varying float vBright;

void main() {
  #include <logdepthbuf_fragment>
  // Мягкий круглый спрайт: гаусс без края — из толпы таких точек и складывается дымная нить.
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float soft = exp(-d * d * 3.5);
  // Глубина — ЦВЕТОМ: вблизи розовое, вдали фиолет. Свет при этом гаснет медленнее (sqrt),
  // чтобы дальний фиолет не исчезал раньше, чем успел прочитаться.
  vec3 col = mix(uFar, uNear, vBright * vBright);
  float alpha = soft * sqrt(vBright) * uGain;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col, alpha);
}
`

export function torusDotMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uNear: { value: new Color(TORUS.EDGE_NEAR_COLOR) },
      uFar: { value: new Color(TORUS.EDGE_FAR_COLOR) },
      uSize: { value: TORUS.DOT_SIZE_PX },
      uGain: { value: TORUS.DOT_INTENSITY },
    },
    vertexShader: DOT_VERT,
    fragmentShader: DOT_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  })
}
