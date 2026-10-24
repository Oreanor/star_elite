import { NormalBlending, ShaderMaterial } from 'three'

/**
 * КЛУБ ОГНЯ — мягкий объёмный ком, а не резкая сфера. Три приёма:
 *   • поверхность гуляет шумом (в вершинах) — край рваный и шевелится;
 *   • к силуэту клуб РАСТВОРЯЕТСЯ (прозрачность по углу к глазу) — краёв-окружностей нет;
 *   • плотность рвётся шумом внутри, и огонь остывает: белый жар → светлый янтарь → дым.
 * Возраст и зерно приходят цветом экземпляра (r — доля жизни 0..1, g — зерно): материал один.
 */

const NOISE = /* glsl */ `
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise3(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}
`

let cache: ShaderMaterial | null = null

export function firePuffMaterial(): ShaderMaterial {
  cache ??= new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vObj;
      varying float vAge;
      varying float vSeed;
      varying float vHeat;
      ${NOISE}
      void main() {
        #ifdef USE_INSTANCING_COLOR
          vAge = instanceColor.r;
          vSeed = instanceColor.g * 100.0;
          vHeat = instanceColor.b * 4.0;
        #else
          vAge = 0.5;
          vSeed = 0.0;
          vHeat = 1.0;
        #endif
        // Комковатая, шевелящаяся поверхность: крупный шум сдвигает вдоль нормали — не шар.
        float bump = fbm(position * 1.3 + vec3(vSeed, vSeed * 0.7, uTime * 0.35 + vAge));
        vec3 p = position * (1.0 + 0.6 * (bump - 0.5));
        vObj = position;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        vV = -mv.xyz;
        vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vObj;
      varying float vAge;
      varying float vSeed;
      varying float vHeat;
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        float facing = abs(dot(normalize(vN), normalize(vV)));
        // К силуэту — растворяется плавно и глубоко: ни одной резкой окружности.
        float soft = pow(smoothstep(0.0, 1.0, facing), 1.4);
        // Плотность рвётся шумом и клубится во времени — с прорехами, а не сплошной диск.
        float n = fbm(vObj * 2.4 + vec3(vSeed, -vSeed * 0.4, uTime * 0.6 + vAge * 2.0));
        float density = soft * smoothstep(0.32, 0.78, n + facing * 0.22);
        // Раскалённый клуб — плотный: прорехи на светлом поверх тьмы читались оливковыми пятнами.
        density = mix(density, soft, clamp((vHeat - 1.0) / 3.0, 0.0, 1.0) * 0.85);
        // Жар — от ВРЕМЕНИ (и чуть от шума), не от угла: иначе по краю каждого клуба проступал
        // тёмный ободок дыма. Свежий — жёлто-белый, остывает в оранжевый, затем в бурый дым.
        // Жар ядра (vHeat > 1) остывает медленнее и горит ярче — центр общего взрыва.
        float heat = clamp(exp(-vAge * 2.6 / vHeat) * (0.7 + 0.6 * n), 0.0, 1.0);
        // Раскалённый клуб не проваливается в дым пятнами: у него свой нижний предел жара.
        heat = max(heat, clamp((vHeat - 1.0) / 3.0, 0.0, 1.0) * exp(-vAge * 1.8));
        // Огонь сноса — БЕЛЫЙ с жёлтым, а не рыжий: глубокий оранжевый спорил с бело-голубым
        // светом ядра и лучами. Остывая, клуб уходит в светлый янтарь, потом в дым.
        vec3 hot = vec3(1.0, 0.95, 0.82);
        vec3 mid = vec3(1.0, 0.68, 0.32);
        vec3 smoke = vec3(0.2, 0.16, 0.13);
        vec3 fire = mix(mid, hot, smoothstep(0.3, 0.85, heat));
        // Ярче — по жару клуба, но умеренно: тёплый белый с ореолом свечения, а не серая заливка.
        float boost = mix(1.0, 1.0 + 0.45 * (vHeat - 1.0), heat);
        vec3 col = mix(smoke, fire, smoothstep(0.12, 0.45, heat)) * (0.75 + 1.5 * heat * (0.6 + 0.4 * facing)) * boost;
        // Сжатие яркости С СОХРАНЕНИЕМ ОТТЕНКА: пересвеченный оранжевый иначе упирался в 1 по
        // красному и зелёному и съезжал в жёлтый — на полупрозрачности он читался оливковым.
        // Белеет огонь только на самом сильном жаре.
        float peak = max(col.r, max(col.g, col.b));
        if (peak > 1.0) col = mix(col / peak, vec3(1.0), smoothstep(1.8, 4.0, peak) * 0.85);
        float alpha = density * pow(1.0 - vAge, 1.2) * (0.55 + 0.45 * heat);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    blending: NormalBlending,
    transparent: true,
    depthWrite: false,
  })
  return cache
}
