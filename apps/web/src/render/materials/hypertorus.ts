import { AdditiveBlending, Color, DoubleSide, Matrix4, ShaderMaterial } from 'three'
import { TORUS } from '../config'
import { STREAM_NOISE } from './massStream'

/**
 * Материалы гипертора: галактика-пуф и непрерывная полупрозрачная нить.
 *
 * Узлов и связей в кадре сотни: мягкий поперечный спад удерживает гало от выгорания в белое.
 */

/** Одна цветовая схема для узлов и потоков: светлое тёплое ядро в фиолетовом гало. */
const GLOW_COLOR = /* glsl */ `
vec3 glowColor(vec3 tint, vec3 haloTint, float core, float halo) {
  vec3 hot = mix(tint, vec3(1.0), core * 0.35);
  return mix(haloTint, hot, core / max(0.0001, core + halo));
}
`

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

${GLOW_COLOR}

void main() {
  #include <logdepthbuf_fragment>
  // Плотное ядро + короткое гало: узкий гаусс даёт чёткую «звёздочку», а не размазанное пятно.
  float r = length(vUv - 0.5) * 2.0;
  if (r > 1.0) discard;
  float core = exp(-r * r * 16.0);     // тугое ядро — видно, ГДЕ галактика
  float halo = exp(-r * r * 3.0) * 0.35 * (1.0 - smoothstep(0.7, 1.0, r));
  float puff = core + halo;
  vec3 col = glowColor(vTint, uHalo, core, halo);
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

/**
 * Лента лицом к камере. Точка дуги приходит в покое S³ и крутится позой здесь:
 * процессор больше не проецирует каждую точку кадра.
 */
const EDGE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec4 aRest;
attribute vec4 aNext;
attribute vec4 aPrev;
attribute float aSide;
attribute vec2 aFlow;
uniform mat4 uPose;
uniform float uScale;
uniform float uThickness;
uniform float uAngular;
uniform float uSpread;
uniform float uPuffAngular;
uniform float uPuffMax;
uniform float uFogNear;
uniform float uFogFar;
uniform float uCut;

varying float vBright;
varying float vSide;
varying vec2 vFlow;

vec3 project(vec4 p) {
  return p.xyz * (uScale / max(1e-4, 1.0 - p.w));
}

void main() {
  vSide = aSide;
  vFlow = aFlow;
  vec4 p4 = uPose * aRest;
  // position объявлен трём и обязан быть использован, иначе атрибут выкинут из программы.
  vec3 pos = project(p4) + position * 0.0;
  vec4 n4 = uPose * aNext;
  vec3 nxt = project(n4);
  // Сосед за полюсом или в тумане — касательная от него рванула бы ленту через весь кадр.
  if (n4.w > uCut) nxt = project(uPose * aPrev);
  vec3 tangent = mat3(modelViewMatrix) * (nxt - pos);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec3 across = cross(tangent, -mv.xyz);
  float len = length(across);
  across = len > 0.00001 ? across / len : vec3(1.0, 0.0, 0.0);
  // Середина — узкая струя, к галактике лента раздаётся. Квадрат тянет ширину вдоль последней трети.
  float along = abs(aFlow.x * 2.0 - 1.0);
  float neck = 0.5 + 2.4 * along * along;
  float denom = max(1e-4, 1.0 - p4.w);
  float halfWidth = uAngular * neck * uScale / denom * uThickness;
  // Пуф считается без раздвижки: лента живёт в масштабе проекции, галактика — нет.
  float puffR = min(uPuffMax, uPuffAngular * uScale / max(uSpread, 0.001) / denom);
  // Узел: торец не шире галактики. Сегмент там короткий, а устье широкое — торец
  // рисуется чёрточкой поперёк потока и при толщине > 1 торчит из узла иголкой.
  halfWidth = mix(halfWidth, min(halfWidth, puffR), along * along);
  mv.xyz += across * halfWidth * aSide;
  gl_Position = projectionMatrix * mv;
  vBright = 1.0 - smoothstep(uFogNear, uFogFar, length(pos));
  #include <logdepthbuf_vertex>
}
`

const EDGE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uCore;
uniform vec3 uFar;
uniform float uGain;
uniform float uTime;

varying float vBright;
varying float vSide;
varying vec2 vFlow;

${STREAM_NOISE}
${GLOW_COLOR}

void main() {
  #include <logdepthbuf_fragment>
  float s = vFlow.x;
  float side = vSide;
  float clock = uTime + vFlow.y;
  // Течение лишь слегка меняет яркость вдоль дуги. Цвет и ширина профиля от шума
  // не зависят: иначе жёлтое ядро рвалось на пятна и выглядело крученой нитью.
  float flow = noise(vec2(s * 6.0 - clock * 0.5, vFlow.y));
  float density = 0.9 + 0.1 * flow;
  float core = exp(-side * side * 8.0);
  float halo = exp(-side * side * 2.8);
  // Без жёсткой кромки: обрез на 0.7 ширины рисовал торец ленты прямой иголкой.
  float edge = (0.7 * core + 0.3 * halo) * (1.0 - smoothstep(0.92, 1.0, abs(side)));
  float fade = smoothstep(0.0, 0.05, s) * (1.0 - smoothstep(0.95, 1.0, s));
  // Цветовой профиль совпадает с галактикой: узкая светлая сердцевина, широкое фиолетовое гало.
  float colorCore = exp(-side * side * 16.0);
  float colorHalo = exp(-side * side * 3.0) * 0.35 * (1.0 - smoothstep(0.92, 1.0, abs(side)));
  vec3 col = glowColor(uCore, uFar, colorCore, colorHalo);
  col = mix(uFar, col, smoothstep(0.15, 0.95, vBright));
  float alpha = edge * density * fade * vBright * vBright * uGain;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col, alpha);
}
`

/**
 * Джет квазара в клубке — лента лицом к камере, не черта. Гаусс поперёк не даёт кромки,
 * вдоль луч тает: у линии в пиксель получалась иголка.
 */
const JET_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 aTangent;
attribute float aWidth;
attribute float aSide;
attribute float aAlong;
attribute float aBright;

varying float vSide;
varying float vAlong;
varying float vBright;

void main() {
  vSide = aSide;
  vAlong = aAlong;
  vBright = aBright;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 tangent = mat3(modelViewMatrix) * aTangent;
  vec3 across = cross(tangent, -mv.xyz);
  float len = length(across);
  across = len > 0.00001 ? across / len : vec3(1.0, 0.0, 0.0);
  mv.xyz += across * aWidth * aSide;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`

const JET_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uTint;

varying float vSide;
varying float vAlong;
varying float vBright;

void main() {
  #include <logdepthbuf_fragment>
  float side = vSide;
  float core = exp(-side * side * 8.0);
  float halo = exp(-side * side * 2.2);
  float beam = (0.7 * core + 0.5 * halo) * (1.0 - smoothstep(0.82, 1.0, abs(side)));
  float along = pow(max(0.0, 1.0 - vAlong), 1.45);
  float alpha = beam * along * vBright;
  if (alpha < 0.003) discard;
  vec3 col = mix(uTint, vec3(1.0), core);
  gl_FragColor = vec4(col, alpha);
}
`

export function torusJetMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTint: { value: new Color(0xd6eeff) },
    },
    vertexShader: JET_VERT,
    fragmentShader: JET_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
  })
}

export function torusEdgeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uCore: { value: new Color(TORUS.PUFF_COLOR) },
      uFar: { value: new Color(TORUS.EDGE_FAR_COLOR) },
      uGain: { value: TORUS.EDGE_INTENSITY },
      uTime: { value: 0 },
      uThickness: { value: TORUS.EDGE_THICKNESS },
      uSpread: { value: TORUS.NODE_SPREAD },
      uPuffAngular: { value: TORUS.PUFF_ANGULAR_R },
      uPuffMax: { value: TORUS.PUFF_MAX_R_M },
      uPose: { value: new Matrix4() },
      uScale: { value: TORUS.SCALE },
      uAngular: { value: TORUS.EDGE_ANGULAR_WIDTH },
      uFogNear: { value: TORUS.FOG_NEAR_M },
      uFogFar: { value: TORUS.FOG_FAR_M },
      uCut: { value: TORUS.POLE_CULL },
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
