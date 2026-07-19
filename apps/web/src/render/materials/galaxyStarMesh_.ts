import {
  AdditiveBlending,
  BackSide,
  IcosahedronGeometry,
  ShaderMaterial,
  type BufferGeometry,
} from 'three'

/**
 * Ближние звёзды галактического слоя: дешёвая сфера + аддитивная корона.
 * Без внешних текстур — процедурное кипение; до ~MESH_MAX инстансов в кадре.
 */

let discGeo: BufferGeometry | null = null
let shellGeo: BufferGeometry | null = null

/** Диск звезды — низкая икосфера (один draw на пачку). */
export function galaxyStarDiscGeometry(): BufferGeometry {
  discGeo ??= new IcosahedronGeometry(1, 2)
  return discGeo
}

/** Корона — чуть больше, BackSide + additive, без билборда. */
export function galaxyStarShellGeometry(): BufferGeometry {
  shellGeo ??= new IcosahedronGeometry(1, 1)
  return shellGeo
}

const discVert = /* glsl */ `
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
varying vec3 vView;
varying vec3 vColorI;
attribute vec3 instanceColor;

void main() {
  vDir = normalize(position);
  vColorI = instanceColor;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`

const discFrag = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uTime;
varying vec3 vDir;
varying vec3 vView;
varying vec3 vColorI;

void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDir);
  // Кипение без карты: дешёвые синусы по направлению.
  float boil = 0.5
    + 0.25 * sin(d.x * 14.0 + uTime * 0.55)
    + 0.15 * sin(d.y * 18.0 - uTime * 0.42)
    + 0.12 * sin((d.x + d.z) * 11.0 + uTime * 0.7);
  float facing = clamp(dot(d, normalize(vView)), 0.0, 1.0);
  float limb = pow(1.0 - facing, 2.2);
  vec3 col = vColorI * (0.65 + 0.45 * boil);
  col *= 1.0 + limb * 1.15;
  col += vColorI * limb * 0.55;
  col += vec3(1.0) * (0.18 + limb * 0.28);
  gl_FragColor = vec4(col, 1.0);
}
`

const shellVert = /* glsl */ `
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
varying vec3 vView;
varying vec3 vColorI;
attribute vec3 instanceColor;

void main() {
  vDir = normalize(position);
  vColorI = instanceColor;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`

const shellFrag = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying vec3 vDir;
varying vec3 vView;
varying vec3 vColorI;

void main() {
  #include <logdepthbuf_fragment>
  float facing = clamp(dot(normalize(vDir), normalize(vView)), 0.0, 1.0);
  // Мягкий лимб: снаружи ярче, к центру прозрачно — не жёсткий диск.
  float rim = pow(1.0 - facing, 1.65);
  float alpha = rim * 0.55;
  if (alpha < 0.02) discard;
  vec3 col = vColorI * (0.9 + rim * 0.8);
  col += vec3(1.0) * rim * 0.4;
  gl_FragColor = vec4(col, alpha);
}
`

export function createGalaxyStarDiscMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: discVert,
    fragmentShader: discFrag,
    uniforms: { uTime: { value: 0 } },
    fog: false,
    toneMapped: false,
  })
}

export function createGalaxyStarShellMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: shellVert,
    fragmentShader: shellFrag,
    transparent: true,
    depthWrite: false,
    side: BackSide,
    blending: AdditiveBlending,
    fog: false,
    toneMapped: false,
  })
}
