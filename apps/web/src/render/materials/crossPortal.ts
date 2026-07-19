import {
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  ShaderMaterial,
  UVMapping,
  type Texture,
} from 'three'
import { loadSky, SKY_COUNT } from '../sky/sky'

/**
 * Кресты: чёрный корпус + окна-маски с jpg-скайбоксом + неоновые рёбра.
 * Скайбокс грузим СВОИМ `loadSky` (не `scene.background`): фон сцены three может
 * готовить под PMREM/фон, а нам нужна обычная 2D-развёртка в кастомном шейдере.
 */

const NEON = new Color(0x66e0ff)
/** Угловой отъезд: 1 = как фон, больше = мельче / «дальше». */
const SKY_DISTANCE = 1.7
/** Яркость в окне — выше фона, иначе маска тонет. */
const SKY_GAIN = 1.8

let bodyFill: MeshBasicMaterial | null = null

/** Чёрный корпус: закрывает дыры, не конкурирует с окнами (они вынесены наружу). */
export function crossBodyMaterial(): MeshBasicMaterial {
  bodyFill ??= new MeshBasicMaterial({
    color: 0x02060c,
    side: DoubleSide,
    depthWrite: true,
    depthTest: true,
    fog: false,
  })
  return bodyFill
}

const PORTAL_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`

const PORTAL_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform sampler2D uSkyMap;
uniform float uHasSky;
uniform float uDistance;
uniform float uIntensity;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

const float PORTAL_PI = 3.14159265359;

vec3 fallbackSky(vec3 dir) {
  float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 band = mix(vec3(0.03, 0.06, 0.14), vec3(0.35, 0.18, 0.55), t);
  float milky = exp(-pow(dir.y * 2.2, 2.0)) * 0.45;
  return band + vec3(0.55, 0.65, 1.0) * milky;
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 n = normalize(vWorldNormal);
  vec3 toCam = normalize(cameraPosition - vWorldPos);
  // Луч сквозь стекло в бесконечность.
  vec3 through = normalize(-toCam);
  // Перевёрт: тот же jpg, другой ракурс, чем у фона сцены.
  through = normalize(vec3(-through.z, through.y, -through.x));

  vec3 cosmos;
  if (uHasSky > 0.5) {
    float phi = atan(through.z, through.x);
    float theta = acos(clamp(through.y, -1.0, 1.0));
    vec2 uv = vec2(phi / (2.0 * PORTAL_PI) + 0.5, theta / PORTAL_PI);
    float dist = max(uDistance, 1.0);
    uv = vec2(0.5) + (uv - vec2(0.5)) / dist;
    uv = clamp(uv, 0.001, 0.999);
    cosmos = texture2D(uSkyMap, uv).rgb * uIntensity;
  } else {
    cosmos = fallbackSky(through) * uIntensity;
  }

  float glass = 0.88 + 0.12 * abs(dot(n, toCam));
  gl_FragColor = vec4(cosmos * glass, 1.0);
}
`

const LAMP_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`

const LAMP_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uNeon;
uniform float uTime;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float across = exp(-vUv.x * vUv.x * 5.5);
  float pulse = 0.92 + 0.08 * sin(uTime * 5.0 + vUv.y * 12.0);
  float a = across * pulse;
  if (a < 0.03) discard;
  vec3 col = mix(uNeon, vec3(1.0), across * across * 0.85);
  gl_FragColor = vec4(col, a);
}
`

function bindSkyTexture(mat: ShaderMaterial, texture: Texture): void {
  // Своя 2D-копия: mapping UV, чтобы кастомный шейдер не делил текстуру с env/PMREM.
  const map = texture.clone()
  map.mapping = UVMapping
  map.needsUpdate = true
  const previous = mat.uniforms.uSkyMap!.value as Texture | null
  if (previous) previous.dispose()
  mat.uniforms.uSkyMap!.value = map
  mat.uniforms.uHasSky!.value = 1
}

export function crossPortalMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uSkyMap: { value: null as Texture | null },
      uHasSky: { value: 0 },
      uDistance: { value: SKY_DISTANCE },
      uIntensity: { value: SKY_GAIN },
    },
    vertexShader: PORTAL_VERT,
    fragmentShader: PORTAL_FRAG,
    side: DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    fog: false,
    toneMapped: false,
  })
}

export function crossNeonLampMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uNeon: { value: NEON.clone() },
      uTime: { value: 0 },
    },
    vertexShader: LAMP_VERT,
    fragmentShader: LAMP_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
  })
}

/** Подставить jpg галактики в окна. Пока грузится — яркий процедурный fallback. */
export function syncCrossPortalSky(mat: ShaderMaterial, galaxySeed: number): void {
  const idx = (((galaxySeed >>> 0) % SKY_COUNT) + SKY_COUNT) % SKY_COUNT
  mat.uniforms.uDistance!.value = SKY_DISTANCE
  mat.uniforms.uIntensity!.value = SKY_GAIN
  if (idx === mat.userData.skyIndex && mat.uniforms.uHasSky!.value > 0.5) return
  mat.userData.skyIndex = idx
  const fallback = loadSky(idx, (texture) => {
    bindSkyTexture(mat, texture)
  })
  bindSkyTexture(mat, fallback)
}

export function tickCrossPortal(mat: ShaderMaterial, time: number): void {
  mat.uniforms.uTime!.value = time
}
