import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three'

/**
 * ПЕРЕТЕКАНИЕ ВЕЩЕСТВА в тесной паре: струя со звезды-донора и диск у компаньона.
 *
 * Оба — свет (аддитивно), не тела. Струя — лента лицом к камере: `uv.x` — доля пути от
 * донора к компаньону, `uv.y` — поперёк (−1..1). По ленте бегут сгустки вниз по течению,
 * края тают, цвет идёт от цвета донора к раскалённому бело-голубому у диска. Диск — кольцо
 * в плоскости пары: спиральные рукава закручиваются внутрь, к центру горячее.
 *
 * `logdepthbuf_*` обязателен: сцена с логарифмической глубиной (см. `starBeam`).
 */

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`

const STREAM_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`

const STREAM_FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uFrom;
  uniform vec3 uHot;
  uniform float uTime;
  uniform float uStrength;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    #include <logdepthbuf_fragment>
    float s = vUv.x;
    float side = vUv.y;
    /* Поперёк: мягкий край, середина плотнее. */
    float edge = exp(-side * side * 3.2);
    /* Сгустки бегут ВНИЗ по течению; волокна вдоль струи. */
    float flow = noise(vec2(s * 38.0 - uTime * 1.6, side * 2.5));
    float fibres = noise(vec2(s * 9.0 - uTime * 0.7, side * 7.0 + 3.0));
    float body = 0.45 + 0.4 * flow + 0.25 * fibres;
    /* Вход — из тела донора (плавно), к концу спирали растворяется в диске. */
    float fade = smoothstep(0.0, 0.05, s) * (1.0 - smoothstep(0.86, 1.0, s));
    vec3 col = mix(uFrom, uHot, smoothstep(0.25, 0.85, s));
    gl_FragColor = vec4(col, uStrength * edge * body * fade);
  }
`

const DISK_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vPos;
  void main() {
    vPos = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`

const DISK_FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uFrom;
  uniform vec3 uHot;
  uniform float uTime;
  uniform float uStrength;
  uniform float uInner;
  uniform float uOuter;
  varying vec2 vPos;
  ${NOISE}
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(vPos);
    float k = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
    float a = atan(vPos.y, vPos.x);
    /* Рукава: угол, закрученный логарифмом радиуса, и вращение быстрее у центра (Кеплер). */
    float swirl = a * 3.0 + log(r) * 7.0 - uTime * (2.4 - 1.6 * k);
    float arms = 0.55 + 0.45 * noise(vec2(swirl, r / uInner * 2.0));
    /* Внутренний край — резкий горячий обод, наружный тает. */
    float ring = smoothstep(0.0, 0.06, k) * pow(1.0 - k, 1.6);
    vec3 col = mix(uHot, uFrom, smoothstep(0.1, 0.9, k));
    gl_FragColor = vec4(col, uStrength * ring * arms);
  }
`

export function createStreamMaterial(fromColor: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: STREAM_VERT,
    fragmentShader: STREAM_FRAG,
    uniforms: {
      uFrom: { value: new Color(fromColor) },
      uHot: { value: new Color(0xf2fbff) },
      uTime: { value: 0 },
      uStrength: { value: 1.25 },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  })
}

/** Диск у компаньона: кольцо `inner..outer` в единицах геометрии (радиус компаньона = 1). */
export function createAccretionDiskMaterial(fromColor: number, inner: number, outer: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: DISK_VERT,
    fragmentShader: DISK_FRAG,
    uniforms: {
      uFrom: { value: new Color(fromColor) },
      uHot: { value: new Color(0xf2fbff) },
      uTime: { value: 0 },
      uStrength: { value: 0.65 },
      uInner: { value: inner },
      uOuter: { value: outer },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  })
}
