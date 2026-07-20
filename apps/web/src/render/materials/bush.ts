import { AdditiveBlending, Color, DoubleSide, LineBasicMaterial, ShaderMaterial } from 'three'
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
varying vec3 vNormalW;
varying vec3 vViewDir;

void main() {
  #ifdef USE_INSTANCING
    mat4 im = instanceMatrix;
  #else
    mat4 im = mat4(1.0);
  #endif
  vec4 world = modelMatrix * im * vec4(position, 1.0);
  vTint = aTint;
  vFog = aFog;
  vNormalW = normalize(mat3(modelMatrix) * mat3(im) * normal);
  vViewDir = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`

const BUBBLE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uPower;
uniform float uRim;
uniform float uBase;
uniform float uAlpha;

varying vec3 vTint;
varying float vFog;
varying vec3 vNormalW;
varying vec3 vViewDir;

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormalW);
  float ndv = abs(dot(n, normalize(vViewDir)));
  // Френель: край силуэта ярок, центр прозрачен — «видно насквозь».
  float fres = pow(1.0 - ndv, uPower);
  // Дешёвая тонкоплёночная радуга: фаза от угла обзора, интерференция трёх «толщин».
  vec3 film = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + fres * 1.6));
  vec3 col = mix(vTint, film, 0.35);
  float alpha = (uBase + fres * uRim) * vFog * uAlpha;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col, alpha);
}
`

export function bushBubbleMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uPower: { value: 2.4 },
      uRim: { value: 0.9 },
      uBase: { value: 0.06 },
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
 * Неоновое ребро. Толщину линии WebGL игнорирует (всегда 1px), но аддитивный ярко-голубой
 * выше порога bloom растекается в свечение — дуга читается неоновой трубкой, а не ниткой.
 * Цвет ВЕРШИННЫЙ: в него зашит туман, и дальние рёбра гаснут вместе с пузырями.
 */
export function bushEdgeMaterial(): LineBasicMaterial {
  return new LineBasicMaterial({
    color: new Color(0xffffff),
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  })
}

/** Базовый цвет ребра (умножается на туман в вершинный цвет). */
export const BUSH_EDGE_RGB = new Color(BUSH.EDGE_COLOR)
