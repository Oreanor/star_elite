import { AdditiveBlending, DoubleSide, NormalBlending, ShaderMaterial } from 'three'

/**
 * КВАЗАР — жрущая чёрная дыра: огромный закрученный газовый диск (жёлто-белое ядро, оранжевые
 * и красные рукава к краю) и рваная пылевая дымка вокруг. Кольцо в плоскости диска, `r` —
 * доля внешнего радиуса (0..1 у диска, до 1.6 у дымки).
 *
 * Диск — свет (аддитивно). Дымка — заслоняет (обычное смешение, тёмная): она съедает звёзды
 * за собой, как пыль на снимках квазаров. Рукава — шум по углу, закрученному логарифмом
 * радиуса; у центра вращение быстрее (Кеплер).
 *
 * `logdepthbuf_*` обязателен: сцена с логарифмической глубиной.
 */

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
    return s;
  }
`

const VERT = /* glsl */ `
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
  uniform float uTime;
  uniform float uStrength;
  uniform float uInner;
  varying vec2 vPos;
  ${NOISE}
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(vPos);
    float a = atan(vPos.y, vPos.x);
    /* Закрутка: угол против логарифма радиуса; у центра вращается быстрее. */
    float spin = uTime * 0.25 / (r + 0.08);
    float swirl = a + log(r + 0.01) * 2.6 + spin;
    float arms = fbm(vec2(cos(swirl) * 3.0 + r * 9.0, sin(swirl) * 3.0 + r * 9.0));
    float streaks = fbm(vec2(swirl * 4.0 + r * 3.0, r * 11.0));
    float gas = 0.35 + 0.9 * arms * (0.6 + 0.6 * streaks);
    /* Ядро — белое и яркое, к краю жёлтый → оранжевый → тёмно-красный и растворение. */
    vec3 core = vec3(1.0, 0.97, 0.85);
    vec3 yellow = vec3(1.0, 0.66, 0.24);
    vec3 orange = vec3(0.95, 0.42, 0.08);
    vec3 red = vec3(0.45, 0.08, 0.03);
    vec3 col = mix(core, yellow, smoothstep(0.0, 0.12, r));
    col = mix(col, orange, smoothstep(0.12, 0.45, r));
    col = mix(col, red, smoothstep(0.45, 0.85, r));
    float glow = 1.0 + 2.2 * exp(-r * 22.0);
    float edge = smoothstep(uInner, uInner * 2.5, r) * (1.0 - smoothstep(0.7, 1.0, r));
    gl_FragColor = vec4(col * glow, uStrength * gas * edge);
  }
`

const DUST_FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uTime;
  uniform float uStrength;
  varying vec2 vPos;
  ${NOISE}
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(vPos);
    float a = atan(vPos.y, vPos.x);
    float swirl = a + log(r) * 1.8 + uTime * 0.03;
    float cloud = fbm(vec2(cos(swirl) * 2.5 + r * 4.0, sin(swirl) * 2.5 + r * 4.0) + 7.0);
    /* Кольцо дымки вокруг диска: гуще у его края, тает наружу. */
    float band = smoothstep(0.55, 0.9, r) * (1.0 - smoothstep(1.1, 1.6, r));
    float alpha = uStrength * band * smoothstep(0.35, 0.8, cloud);
    vec3 col = mix(vec3(0.06, 0.05, 0.05), vec3(0.22, 0.18, 0.15), cloud);
    gl_FragColor = vec4(col, alpha);
  }
`

/** Газовый диск квазара. `inner` — доля внешнего радиуса, где диск начинается (у горизонта). */
export function createQuasarDiskMaterial(inner: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: DISK_FRAG,
    uniforms: { uTime: { value: 0 }, uStrength: { value: 1.0 }, uInner: { value: inner } },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  })
}

/** Пылевая дымка вокруг диска — тёмная, заслоняет звёзды за собой. */
export function createQuasarDustMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: DUST_FRAG,
    uniforms: { uTime: { value: 0 }, uStrength: { value: 0.75 } },
    transparent: true,
    blending: NormalBlending,
    depthWrite: false,
    side: DoubleSide,
  })
}

