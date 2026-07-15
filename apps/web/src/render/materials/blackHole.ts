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
  // Радиус сферы влияния в Rs. Чем больше — тем ДЛИННЕЕ путь искривления луча, и тем
  // сильнее дальняя сторона диска заворачивается над тенью в единый нимб, а не висит
  // отдельной аркой («двоение» издали). 18 — как в ТЗ; было 14, оттого диск с далёкой
  // дистанции читался как две плоские полосы (перёд и зад наклонного кольца).
  influenceMultiplier: 18,
  // Тень ЧУТЬ КРУПНЕЕ физического b_crit (√27/2 = 2.598): на боках линзированный
  // внутренний образ диска обрывается рваной кромкой — «ушами». Чистый чёрный круг
  // побольше накрывает эту рвань, и силуэт снова читается ровным. Доводок визуальный,
  // тень и так рисуется отдельно от лизинга.
  visibleShadow: 2.95,
  // Внутренний край диска прижат к новой кромке тени (≈ фотонное кольцо 2.96 Rs), а не к
  // ISCO 3 Rs — иначе между чёрным шаром и диском зиял бы тёмный зазор, и шар читался
  // «отдельно». Тесно к тени — «ушей» и зазора нет разом.
  diskInner: 2.99,
  diskOuter: 10.5,
  // Вертикальная полутолщина диска в Rs. Диск копится как слой с гауссовым профилем по
  // высоте, а не как лист: тонкий лист аляйсит в зубцы на дискретном шаге, слой — гладкий.
  diskThickness: 0.34,
  coronaIntensity: 0.2,
  diskIntensity: 1.25,
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
uniform float uDiskThickness;
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
  // Гасим полосы там, где фаза бежит быстрее пикселя (косой обзор, дальний обод):
  // недорисованная высокочастотная полоса иначе рассыпается на зубцы.
  float attenuation = 1.0 / (1.0 + fwidth(phase) * 3.0);
  float bands = 0.9 + 0.1 * sin(phase) * attenuation;
  bands *= 0.92 + 0.08 * smoothNoise(hit / uRs * 0.4 + vec3(0.0, 0.0, uTime * 0.04));
  float t = clamp((radial - uDiskInner) / max(uDiskOuter - uDiskInner, 0.001), 0.0, 1.0);
  vec3 hot = vec3(1.0, 0.96, 0.72);
  vec3 cool = vec3(1.0, 0.20, 0.015);
  vec3 color = mix(hot, cool, pow(t, 0.55)) * bands * uDiskIntensity;

  // Релятивистское усиление (доплер-бустинг ∝ D³): приближающаяся сторона диска резко
  // ярче удаляющейся. Физически отношение ~10–30×; берём выразительное, но не рвущее
  // кадр ~6–8× (было вялое 1.8×, оттого диск читался почти симметричным).
  vec3 spin = normalize(cross(n, hit));
  float doppler = clamp(1.0 + 1.1 * dot(spin, -rd), 0.35, 2.8);
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

  // Прицельный параметр луча (перпендикуляр от центра до луча). У силуэта сферы
  // влияния b→uInfluence; по нему сводим ВСЁ искажение к нулю у самой кромки, чтобы
  // сфера-«пузырь» растворялась в фон без чёткой границы, а не врезалась мылом.
  float b = length(cross(ro, rd));
  float edgeFade = 1.0 - smoothstep(uInfluence * 0.70, uInfluence * 0.97, b);

  vec3 glow = vec3(0.0);
  vec3 disk = vec3(0.0);
  float diskAlpha = 0.0;

  for (int i = 0; i < 72; i++) {
    if (i >= uSteps) break;

    float r = length(p);
    if (r < uVisibleShadow * uRs) {
      // Внутри тени — чистый чёрный, без свечения: горизонт ничего не излучает.
      gl_FragColor = vec4(0.0, 0.0, 0.0, edgeFade);
      return;
    }
    if (i > 0 && r >= uInfluence) break;

    float planeH = dot(p, n);
    vec3 onPlane = p - n * planeH;
    float radialP = length(onPlane);

    float stepSize = clamp((r - uRs) * 0.16, 0.025 * uRs, 0.75 * uRs);
    // Мельче у ПЛОСКОСТИ диска — ровнее ложится слой; и мельче у ФОТОННОГО КОЛЬЦА
    // (сфера r≈2.83 Rs) — иначе издали редкие шаги режут узкое кольцо на КУСКИ.
    if (
      abs(planeH) < uDiskThickness * 3.0 * uRs &&
      radialP > uDiskInner - 0.6 * uRs &&
      radialP < uDiskOuter + 0.6 * uRs
    ) {
      stepSize = min(stepSize, 0.06 * uRs);
    }
    if (abs(r - 2.96 * uRs) < 0.45 * uRs) {
      stepSize = min(stepSize, 0.05 * uRs);
    }

    // Фотонное кольцо СИДИТ НА КРОМКЕ ТЕНИ (2.96 Rs). Копим каждый шаг по гауссу от
    // радиуса — тонкое и яркое по самому обводу, без зазора между тенью и кольцом.
    float photon = exp(-pow((r - 2.96 * uRs) / (0.15 * uRs), 2.0));
    glow += vec3(1.0, 0.88, 0.60) * photon * uCoronaIntensity * 0.9 * stepSize / uRs;

    // ДИСК — не бесконечно тонкий лист (он аляйсит в зубцы на дискретном шаге), а СЛОЙ
    // с мягким вертикальным профилем: на каждом шаге у плоскости копим немного свечения
    // по гауссу от высоты. Интеграл вдоль луча выходит гладким — внутренний край не
    // дробится, а издали слой ровно тускнеет (вклад ∝ длине шага), а не рвётся на куски.
    // Луч продолжает идти сквозь слой — дальняя сторона сама загибается над и под тенью
    // (никакого «Сатурна»), а высшие образы гаснут: альфа насыщается, вклад обрезан.
    if (radialP >= uDiskInner && radialP <= uDiskOuter && diskAlpha < 0.995) {
      float vfall = exp(-pow(planeH / (uDiskThickness * uRs), 2.0));
      if (vfall > 0.003) {
        float span = max(uDiskOuter - uDiskInner, 0.001);
        float tt = (radialP - uDiskInner) / span;
        float innerEdge = smoothstep(0.0, 0.14, tt);
        float outerEdge = 1.0 - smoothstep(0.45, 1.0, tt);
        outerEdge *= outerEdge;
        // Насыщается по альфе: на косом (краевом) обзоре слой оптически толстый, но не
        // взрывается в белое — видим ЦВЕТ диска на полной непрозрачности, а не пересвет.
        float dens = min(vfall * innerEdge * outerEdge * (stepSize / uRs) * 3.4, 1.0 - diskAlpha);
        disk += diskColor(onPlane, n, tangent, bitangent, rd, radialP) * dens;
        diskAlpha += dens;
      }
    }

    // Изгиб луча к центру. Коэффициент 1.0 даёт ТОЧНОЕ отклонение α = 2·Rs/b (интеграл
    // 1/r³ по прямой). Было 1.25 — перегиб на 25%. Тень и кольцо моделируем отдельно.
    vec3 perpendicular = p - rd * dot(p, rd);
    vec3 bending = -1.0 * uRs * perpendicular / max(r * r * r, 0.0001);
    rd = normalize(rd + bending * stepSize);
    p = p + rd * stepSize;
  }

  // Композитинг предумноженный: небо просвечивает на (1 − diskAlpha), диск уже накоплен
  // с весом, кольцо-glow — аддитивно поверх. Альфа кадра = edgeFade: у кромки пузыря
  // искажение сходит к нулю и сквозь неё виден настоящий фон, без шва.
  vec3 warpedSky = sampleSky(rd);
  vec3 color = warpedSky * (1.0 - diskAlpha) + disk + glow;
  gl_FragColor = vec4(color, edgeFade);
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
      uDiskThickness: { value: BLACK_HOLE_DEFAULTS.diskThickness },
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
    // Прозрачный: у кромки пузыря альфа (edgeFade) уходит в ноль, и линза бесшовно
    // растворяется в настоящий звёздный фон, а не обрывается чётким кругом.
    transparent: true,
    toneMapped: false,
  })
}
