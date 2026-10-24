import { Color, MeshLambertMaterial, type WebGLProgramParametersWithUniforms } from 'three'

/**
 * ЛАВА поверх обычного камня: Lambert, освещённый звездой как всё в сцене, плюс свечение
 * (emissive) по маске шума в координатах самого тела — рисунок едет вместе с ним, а не по
 * экрану. Два применения: глыба остывает (трещины сужаются и краснеют), планета перед
 * разрывом закипает (пятна лавы растут и сливаются).
 */

const NOISE = /* glsl */ `
float lavaHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float lavaNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(lavaHash(i), lavaHash(i + vec3(1, 0, 0)), f.x), mix(lavaHash(i + vec3(0, 1, 0)), lavaHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(lavaHash(i + vec3(0, 0, 1)), lavaHash(i + vec3(1, 0, 1)), f.x), mix(lavaHash(i + vec3(0, 1, 1)), lavaHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// Остывание лавы одной шкалой: 1 — жёлто-белая, 0.5 — оранжевая, 0 — тёмно-вишнёвая.
vec3 lavaGlow(float h) {
  vec3 white = vec3(1.0, 0.85, 0.5);
  vec3 orange = vec3(1.0, 0.38, 0.06);
  vec3 cherry = vec3(0.45, 0.05, 0.02);
  return h > 0.5 ? mix(orange, white, pow((h - 0.5) * 2.0, 2.0)) : mix(cherry, orange, h * 2.0);
}
`

type Uniform = { value: number }

/** Lambert с маской свечения: `glsl` пишет `totalEmissiveRadiance` из `vLavaObj` и униформ. */
function lavaMaterial(
  key: string,
  params: ConstructorParameters<typeof MeshLambertMaterial>[0],
  uniforms: Record<string, Uniform>,
  glsl: string,
  /** Сдвиг вершин: правит `transformed` (рисунок лавы остаётся привязан к исходной точке). */
  vertexGlsl = '',
): MeshLambertMaterial {
  const mat = new MeshLambertMaterial(params)
  const decl = Object.keys(uniforms)
    .map((k) => `uniform float ${k};`)
    .join('\n')
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLavaObj;\n${decl}\n${NOISE}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLavaObj = position;\n{\n${vertexGlsl}\n}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLavaObj;\n${decl}\n${NOISE}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n{\n${glsl}\n}`)
  }
  // Свой ключ кеша программ: по умолчанию three берёт текст `onBeforeCompile`, а он у всех
  // лавовых материалов один — глыба и планета получили бы один и тот же шейдер.
  mat.customProgramCacheKey = () => key
  return mat
}

/**
 * РАСКАЛЁННАЯ ГЛЫБА: тёмная корка, по ней сетка светящихся трещин. Светится не весь кусок
 * (сплошная заливка читалась «тупо оранжевой», ни камнем, ни лавой), а только швы.
 * Остывая (`heat` 1 → 0), трещины сужаются и краснеют, и глыба становится просто камнем.
 */
export interface LavaChunkMaterial extends MeshLambertMaterial {
  userData: { heat: Uniform; seed: Uniform }
}

export function lavaChunkMaterial(): LavaChunkMaterial {
  const heat = { value: 1 }
  const seed = { value: 0 }
  const mat = lavaMaterial(
    'lava-chunk',
    { vertexColors: true, flatShading: true, color: new Color(0x4a423b) },
    { uHeat: heat, uSeed: seed },
    /* glsl */ `
  vec3 q = vLavaObj * 2.6 + vec3(uSeed);
  // Два слоя гребней: крупные разломы и мелкая сетка между ними.
  float big = abs(lavaNoise(q) - 0.5);
  float fine = abs(lavaNoise(q * 2.7 + 11.0) - 0.5);
  // Шов сужается с остыванием: горячая глыба вся в разломах, остывшая — в тонких прожилках.
  float w = mix(0.015, 0.065, uHeat);
  float crack = max(1.0 - smoothstep(0.0, w, big), 0.45 * (1.0 - smoothstep(0.0, w * 0.6, fine)));
  // Корка тлеет еле заметно, пока горяча, — красным, не белым: белое тление серило камень.
  float ember = 0.08 * uHeat * uHeat;
  totalEmissiveRadiance = lavaGlow(uHeat) * crack * (0.5 + 1.1 * uHeat) * smoothstep(0.0, 0.08, uHeat)
    + lavaGlow(uHeat * 0.5) * ember;`,
  ) as LavaChunkMaterial
  mat.userData = { heat, seed }
  return mat
}

/**
 * ЗАКИПАЮЩАЯ ПЛАНЕТА — последние секунды перед разрывом. Тело выглядит собой (своя карта, свет
 * звезды), но по нему проступают пятна лавы: сначала редкие тёмно-красные точки, потом они
 * растут, светлеют и сливаются в озёра. `progress` 0 → 1 — ход к разрыву.
 */
export interface LavaPlanetMaterial extends MeshLambertMaterial {
  userData: { progress: Uniform; seed: Uniform; time: Uniform }
}

export function lavaPlanetMaterial(): LavaPlanetMaterial {
  const progress = { value: 0 }
  const seed = { value: 0 }
  const time = { value: 0 }
  const mat = lavaMaterial(
    'lava-planet',
    // Вершинные цвета — запасной облик, пока карта тела не пришла (как у `planetMaterial`).
    { vertexColors: true },
    { uProgress: progress, uSeed: seed, uTime: time },
    /* glsl */ `
  vec3 q = vLavaObj * 5.0 + vec3(uSeed);
  float n = lavaNoise(q) * 0.6 + lavaNoise(q * 2.3 + 7.0) * 0.3 + lavaNoise(q * 5.1 + 3.0) * 0.1;
  // Порог опускается с ходом — пятна растут из редких точек в озёра; ход p^1.2: вначале
  // медленнее, к разрыву быстрее. К концу лава занимает большую часть тела, корка — острова.
  float p = pow(uProgress, 1.2);
  float thr = mix(0.83, 0.42, p);
  float lava = smoothstep(thr, thr + 0.04, n);
  // Жар пятна: глубже в пятне и ближе к разрыву — светлее, но белеет лишь сердцевина в конце.
  float h = clamp(0.1 + 0.4 * p + (n - thr) * 2.0, 0.0, 0.85);
  totalEmissiveRadiance = lavaGlow(h) * lava * (0.6 + 0.6 * p);
  // Лава ЗАМЕЩАЕТ камень, а не ложится поверх освещённого: иначе свет звезды плюс свечение
  // пересвечивали пятна в белое. Корка вокруг темнеет — обугливается от жара.
  diffuseColor.rgb *= (1.0 - 0.9 * lava) * (1.0 - 0.45 * p);`,
    /* glsl */ `
  // Последние секунды форма ПЛЫВЁТ, как мыльный пузырь: медленные крупные волны по всей
  // поверхности. Колебание НАРАСТАЕТ: с середины хода чуть заметно, к разрыву размах до ~1%
  // радиуса (квадрат хода) и волны бегут всё быстрее — тело уже не держит себя.
  float wob = pow(smoothstep(0.5, 1.0, uProgress), 2.0);
  // Фаза разгоняется монотонно (добавка от хода только растёт) — без рывков назад.
  float phase = uTime + 6.0 * pow(uProgress, 3.0);
  vec3 drift = vec3(phase * 0.9, phase * 0.6, -phase * 0.7);
  float swell = lavaNoise(position * 6.4 + drift + vec3(uSeed)) - 0.5;
  float ripple = sin(dot(position, vec3(2.1, 1.3, -1.7)) * 8.0 + phase * 4.0);
  transformed += normal * wob * (0.02 * swell + 0.004 * ripple);`,
  ) as LavaPlanetMaterial
  mat.userData = { progress, seed, time }
  return mat
}
