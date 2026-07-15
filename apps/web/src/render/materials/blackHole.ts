import {
  FrontSide,
  ShaderMaterial,
  Vector3,
  type Texture,
} from 'three'

/** Параметры линзирования (радиусы диска — в долях Rs). */
export interface BlackHoleParams {
  radius: number
  diskAxis: Vector3
  diskInnerRadius: number
  diskOuterRadius: number
  coronaIntensity: number
  diskIntensity: number
  rotationSpeed: number
  quality: number
}

export const BLACK_HOLE_DEFAULTS = {
  influenceMultiplier: 14,
  visibleShadow: 2.598,
  diskInner: 3,
  diskOuter: 10.5,
  coronaIntensity: 0.2,
  diskIntensity: 1.1,
  rotationSpeed: 0.28,
  quality: 64,
} as const

const lensVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vWorldPos;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`

const lensFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uBhCenter;
uniform vec3 uCameraPos;
uniform float uRs;
uniform float uInfluence;
uniform float uVisibleShadow;
uniform float uDiskInner;
uniform float uDiskOuter;
uniform float uCoronaIntensity;
uniform float uDiskIntensity;
uniform float uRotationSpeed;
uniform float uTime;
uniform int uSteps;
uniform vec3 uDiskAxis;
uniform sampler2D uSkyMap;
uniform bool uHasSky;
uniform float uSkyIntensity;

varying vec3 vWorldPos;

vec3 sampleSky(vec3 dir) {
  dir = normalize(dir);
  if (!uHasSky) {
    float t = dir.y * 0.5 + 0.5;
    return mix(vec3(0.01, 0.02, 0.06), vec3(0.04, 0.07, 0.14), t);
  }
  float phi = atan(dir.z, dir.x);
  float theta = acos(clamp(dir.y, -1.0, 1.0));
  vec2 uv = vec2(phi / (2.0 * PI) + 0.5, theta / PI);
  return texture2D(uSkyMap, uv).rgb * uSkyIntensity;
}

void diskBasis(vec3 nIn, out vec3 n, out vec3 tangent, out vec3 bitangent) {
  n = normalize(nIn);
  vec3 ref = abs(n.y) < 0.92 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  tangent = normalize(cross(ref, n));
  bitangent = cross(n, tangent);
}

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float smoothNoise(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(cell), hash31(cell + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash31(cell + vec3(0.0, 1.0, 0.0)), hash31(cell + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash31(cell + vec3(0.0, 0.0, 1.0)), hash31(cell + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash31(cell + vec3(0.0, 1.0, 1.0)), hash31(cell + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z
  );
}

vec3 diskColor(vec3 hit, vec3 n, vec3 tangent, vec3 bitangent, vec3 rd, float radial) {
  float angle = atan(dot(hit, bitangent), dot(hit, tangent));
  float phase = radial / uRs * 2.5 + angle * 2.0 - uTime * uRotationSpeed * 1.8;
  float attenuation = 1.0 / (1.0 + fwidth(phase) * 2.0);
  float bands = 0.9 + 0.1 * sin(phase) * attenuation;
  bands *= 0.92 + 0.08 * smoothNoise(hit / uRs * 0.4 + vec3(0.0, 0.0, uTime * 0.04));
  float t = clamp((radial - uDiskInner) / max(uDiskOuter - uDiskInner, 0.001), 0.0, 1.0);
  vec3 hot = vec3(1.0, 0.96, 0.72);
  vec3 cool = vec3(1.0, 0.20, 0.015);
  vec3 color = mix(hot, cool, pow(t, 0.55)) * bands * uDiskIntensity;

  // Релятивистская асимметрия: приближающаяся сторона ярче удаляющейся.
  vec3 spin = normalize(cross(n, hit));
  float doppler = clamp(1.0 + 0.65 * dot(spin, -rd), 0.35, 1.8);
  return color * doppler;
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 ro = uCameraPos - uBhCenter;
  vec3 rd = normalize(vWorldPos - uCameraPos);
  // Начинаем на ПЕРЕДНЕЙ поверхности сферы влияния. Раньше p=ro (камера),
  // и при камере снаружи первый же шаг r>influence завершал трассировку.
  vec3 p = vWorldPos - uBhCenter;

  vec3 n;
  vec3 tangent;
  vec3 bitangent;
  diskBasis(uDiskAxis, n, tangent, bitangent);

  float prevH = dot(p, n);
  vec3 glow = vec3(0.0);
  vec3 disk = vec3(0.0);
  float diskAlpha = 0.0;

  for (int i = 0; i < 72; i++) {
    if (i >= uSteps) break;

    float r = length(p);
    if (r < uVisibleShadow * uRs) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    if (i > 0 && r >= uInfluence) break;

    float stepSize = clamp((r - uRs) * 0.16, 0.025 * uRs, 0.75 * uRs);
    float planeDistance = abs(dot(p, n));
    vec3 projected = p - n * dot(p, n);
    float projectedRadius = length(projected);
    if (
      planeDistance < 0.8 * uRs &&
      projectedRadius > uDiskInner - 0.5 * uRs &&
      projectedRadius < uDiskOuter + 0.5 * uRs
    ) {
      stepSize = min(stepSize, 0.08 * uRs);
    }

    // Фотонное кольцо — узкое, бело-золотое, а не объёмный красный шар.
    float photon = exp(-pow((r - 2.75 * uRs) / (0.16 * uRs), 2.0));
    glow += vec3(1.0, 0.86, 0.55) * photon * uCoronaIntensity * stepSize / uRs;

    vec3 perpendicular = p - rd * dot(p, rd);
    vec3 bending = -1.25 * uRs * perpendicular / max(r * r * r, 0.0001);
    vec3 nextRd = normalize(rd + bending * stepSize);
    vec3 nextP = p + nextRd * stepSize;

    // Пересечение искривлённого луча с плоскостью диска. Поэтому дальняя часть
    // диска загибается над и под тенью, а не остаётся плоским кольцом «Сатурна».
    float nextH = dot(nextP, n);
    if (prevH * nextH <= 0.0) {
      float denom = prevH - nextH;
      float crossT = abs(denom) > 0.000001 ? clamp(prevH / denom, 0.0, 1.0) : 0.0;
      vec3 hit = mix(p, nextP, crossT);
      vec3 onPlane = hit - n * dot(hit, n);
      float radial = length(onPlane);
      if (radial >= uDiskInner && radial <= uDiskOuter) {
        float aa = max(fwidth(radial) * 2.0, 0.08 * uRs);
        float innerEdge = smoothstep(uDiskInner, uDiskInner + aa, radial);
        float outerEdge = 1.0 - smoothstep(uDiskOuter - aa, uDiskOuter, radial);
        float opacity = innerEdge * outerEdge * 0.82;
        vec3 color = diskColor(onPlane, n, tangent, bitangent, rd, radial);
        disk += color * opacity * (1.0 - diskAlpha);
        diskAlpha += opacity * (1.0 - diskAlpha);
      }
    }

    prevH = nextH;
    rd = nextRd;
    p = nextP;
  }

  vec3 warpedSky = sampleSky(rd);
  vec3 color = mix(warpedSky, disk, diskAlpha) + glow;
  gl_FragColor = vec4(color, 1.0);
}
`

export function createBlackHoleMaterial(params: BlackHoleParams, sky: Texture | null): ShaderMaterial {
  const influence = params.radius * BLACK_HOLE_DEFAULTS.influenceMultiplier
  return new ShaderMaterial({
    uniforms: {
      uBhCenter: { value: new Vector3() },
      uCameraPos: { value: new Vector3() },
      uRs: { value: params.radius },
      uInfluence: { value: influence },
      uVisibleShadow: { value: BLACK_HOLE_DEFAULTS.visibleShadow },
      uDiskInner: { value: params.diskInnerRadius * params.radius },
      uDiskOuter: { value: params.diskOuterRadius * params.radius },
      uCoronaIntensity: { value: params.coronaIntensity },
      uDiskIntensity: { value: params.diskIntensity },
      uRotationSpeed: { value: params.rotationSpeed },
      uTime: { value: 0 },
      uSteps: { value: Math.round(Math.min(72, Math.max(48, params.quality))) },
      uDiskAxis: { value: params.diskAxis.clone().normalize() },
      uSkyMap: { value: sky },
      uHasSky: { value: sky != null },
      uSkyIntensity: { value: 1 },
    },
    vertexShader: lensVertex,
    fragmentShader: lensFragment,
    side: FrontSide,
    depthWrite: false,
    depthTest: true,
    transparent: false,
    toneMapped: false,
  })
}
