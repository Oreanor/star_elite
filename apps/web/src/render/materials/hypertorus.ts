import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three'
import { TORUS } from '../config'
import { STREAM_NOISE } from './massStream'

/**
 * Материалы гипертора: галактика-пуф и непрерывная полупрозрачная нить.
 *
 * Узлов и связей в кадре сотни: мягкий поперечный спад удерживает гало от выгорания в белое.
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
uniform vec3 uHalo;

varying vec3 vTint;
varying float vFog;
varying vec2 vUv;

void main() {
  #include <logdepthbuf_fragment>
  // Плотное ядро + короткое гало: узкий гаусс даёт чёткую «звёздочку», а не размазанное пятно.
  float r = length(vUv - 0.5) * 2.0;
  if (r > 1.0) discard;
  float core = exp(-r * r * 16.0);     // тугое ядро — видно, ГДЕ галактика
  float halo = exp(-r * r * 3.0) * 0.35 * (1.0 - smoothstep(0.7, 1.0, r));
  float puff = core + halo;
  vec3 hot = mix(vTint, vec3(1.0), core * 0.35);
  vec3 col = mix(uHalo, hot, core / max(0.0001, puff));
  float alpha = puff * vFog * uGain;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col, alpha);
}
`

export function torusPuffMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uGain: { value: TORUS.PUFF_INTENSITY },
      uHalo: { value: new Color(TORUS.EDGE_FAR_COLOR) },
    },
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

/** Лента развёрнута к камере; общие вершины сохраняют непрерывность на изгибах. */
const EDGE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute float aBright;
attribute vec3 aTangent;
attribute float aWidth;
attribute float aSide;
attribute vec2 aFlow;
uniform float uThickness;

varying float vBright;
varying float vSide;
varying vec2 vFlow;

void main() {
  vBright = aBright;
  vSide = aSide;
  vFlow = aFlow;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 tangent = mat3(modelViewMatrix) * aTangent;
  vec3 across = cross(tangent, -mv.xyz);
  float len = length(across);
  across = len > 0.00001 ? across / len : vec3(1.0, 0.0, 0.0);
  mv.xyz += across * aWidth * aSide * uThickness;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`

const EDGE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uNear;
uniform vec3 uFar;
uniform float uGain;
uniform float uTime;

varying float vBright;
varying float vSide;
varying vec2 vFlow;

${STREAM_NOISE}

void main() {
  #include <logdepthbuf_fragment>
  float s = vFlow.x;
  float side = vSide;
  float clock = uTime + vFlow.y;
  // Течение лишь слегка меняет яркость вдоль дуги. Цвет и ширина профиля от шума
  // не зависят: иначе жёлтое ядро рвалось на пятна и выглядело крученой нитью.
  float flow = noise(vec2(s * 6.0 - clock * 0.5, vFlow.y));
  float density = 0.9 + 0.1 * flow;
  float core = exp(-side * side * 7.0);
  float halo = exp(-side * side * 2.5);
  float edge = (0.6 * core + 0.4 * halo) * (1.0 - smoothstep(0.7, 1.0, abs(side)));
  float fade = smoothstep(0.0, 0.04, s) * (1.0 - smoothstep(0.96, 1.0, s));
  // Непрерывный тёплый центр и фиолетовые края; дальность плавно гасит и охлаждает нить.
  float warmth = smoothstep(0.15, 0.95, vBright) * core;
  vec3 col = mix(uFar, uNear, warmth);
  float alpha = edge * density * fade * vBright * vBright * uGain;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col, alpha);
}
`

export function torusEdgeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uNear: { value: new Color(TORUS.EDGE_NEAR_COLOR) },
      uFar: { value: new Color(TORUS.EDGE_FAR_COLOR) },
      uGain: { value: TORUS.EDGE_INTENSITY },
      uTime: { value: 0 },
      uThickness: { value: TORUS.EDGE_THICKNESS },
    },
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
