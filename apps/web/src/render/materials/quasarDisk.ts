import { AdditiveBlending, Color, DoubleSide, NormalBlending, ShaderMaterial } from 'three'

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
  uniform vec3 uCore;
  uniform vec3 uMid;
  uniform vec3 uOuter;
  uniform vec3 uRim;
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
    vec3 col = mix(uCore, uMid, smoothstep(0.0, 0.12, r));
    col = mix(col, uOuter, smoothstep(0.12, 0.45, r));
    col = mix(col, uRim, smoothstep(0.45, 0.85, r));
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

/**
 * ПАЛИТРЫ квазаров: ядро → середина → наружная часть → край, и цвет джетов. Квазар берёт
 * свою по доле `palette` (`quasarLook`): тёплый оранжевый, горячий бело-голубой, пурпурный.
 */
export const QUASAR_PALETTES = [
  { core: 0xfff7d9, mid: 0xffa83d, outer: 0xf26b14, rim: 0x731408, jet: 0x9fd0ff },
  { core: 0xf4fbff, mid: 0x9fd8ff, outer: 0x3f7fe0, rim: 0x14205e, jet: 0xd8f0ff },
  { core: 0xfff0f6, mid: 0xff8fb8, outer: 0xc0306e, rim: 0x3c0a2c, jet: 0xc7a8ff },
  { core: 0xfffbe8, mid: 0xffe08a, outer: 0xd99a2b, rim: 0x5a3008, jet: 0xa6ffe9 },
] as const

export function quasarPalette(share: number): (typeof QUASAR_PALETTES)[number] {
  return QUASAR_PALETTES[Math.min(QUASAR_PALETTES.length - 1, Math.floor(share * QUASAR_PALETTES.length))]!
}

/** Газовый диск квазара. `inner` — доля внешнего радиуса, где диск начинается (у горизонта). */
export function createQuasarDiskMaterial(inner: number, palette: (typeof QUASAR_PALETTES)[number] = QUASAR_PALETTES[0]): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: DISK_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uStrength: { value: 1.0 },
      uInner: { value: inner },
      uCore: { value: new Color(palette.core) },
      uMid: { value: new Color(palette.mid) },
      uOuter: { value: new Color(palette.outer) },
      uRim: { value: new Color(palette.rim) },
    },
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

