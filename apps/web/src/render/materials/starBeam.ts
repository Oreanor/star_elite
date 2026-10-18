import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three'

/**
 * ЛУЧ СВЕТИЛА — джет квазара или маяк пульсара. Не твёрдый конус, а свет в объёме:
 *
 *  - КРАЙ ТАЕТ. Прозрачность — от угла поверхности к взгляду: кромка конуса, видная вскользь,
 *    уходит в ноль, середина светится. Плоский материал давал резкий клин-«плиту».
 *  - ВДОЛЬ ГАСНЕТ: ярко у светила, к концу растворяется; у самой вершины — плавный вход.
 *  - ЖИВЁТ: по струе бегут сгустки (у джетов квазаров они и вправду есть — «узлы»).
 *
 * Слоёв два, один материал: узкое плотное ЯДРО и широкий тусклый ОРЕОЛ (`uStrength`, масштаб
 * меша задаёт `StarBeams`). Оба аддитивны — это свет, они складываются.
 *
 * `logdepthbuf_*` обязателен: сцена с логарифмической глубиной (см. `plasmaBeam`).
 */

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec3 vNormalV;
  varying vec3 vViewV;
  varying float vAlong;
  varying float vAngle;

  void main() {
    /* Конус: вершина в 0, основание на +Y (см. beamCone): position.y — доля длины. */
    vAlong = position.y;
    vAngle = atan(position.z, position.x);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`

const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uTime;
  uniform float uKnots;
  uniform float uAlongFade;
  uniform float uStart;
  varying vec3 vNormalV;
  varying vec3 vViewV;
  varying float vAlong;
  varying float vAngle;

  void main() {
    #include <logdepthbuf_fragment>
    /* Кромка вскользь — ноль, лицом к нам — полная: объём, а не стенка. */
    float facing = abs(dot(normalize(vNormalV), normalize(vViewV)));
    float soft = pow(facing, 2.2);
    /* Вдоль: плавный вход у светила и растворение к концу. */
    /* uAlongFade = 0 — без затухания по длине: так тот же свет годится и для шара-комы. */
    /* Вход у основания — в долях длины до кромки тела (uStart), а не фиксированные 4%: у
       маленькой дыры с длинным джетом 4% длины — десятки миллионов км пустоты у самой дыры. */
    float fade = mix(1.0, smoothstep(0.0, uStart, vAlong) * pow(max(0.0, 1.0 - vAlong), 1.8), uAlongFade);
    /* Сгустки бегут прочь от светила; поперечная рябь ломает правильность. */
    float knots = 1.0 - uKnots + uKnots * (0.55 + 0.45 * sin(vAlong * 46.0 - uTime * 2.6 + sin(vAngle * 3.0) * 1.3));
    float a = uStrength * soft * fade * knots;
    gl_FragColor = vec4(uColor, a);
  }
`

/**
 * @param strength Яркость слоя: ядро ~0.5, ореол ~0.12.
 * @param knots Насколько видны сгустки, 0..1: у джетов заметны, у маяка слабее.
 * @param alongFade 1 — гаснет вдоль длины (лучи, хвосты); 0 — нет (кома кометы, шар).
 */
export function createStarBeamMaterial(color: number, strength: number, knots: number, alongFade = 1): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uColor: { value: new Color(color) },
      uStrength: { value: strength },
      uTime: { value: 0 },
      uKnots: { value: knots },
      uAlongFade: { value: alongFade },
      uStart: { value: 0.04 },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  })
}

const GLOW_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`

const GLOW_FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    /* Гауссово облако: края нет вовсе — свет тает в ноль задолго до кромки квадрата. */
    float r2 = dot(vUv, vUv);
    float a = uStrength * exp(-r2 * 5.0) * (1.0 - smoothstep(0.8, 1.0, r2));
    gl_FragColor = vec4(uColor, a);
  }
`

/**
 * Мягкое СВЕЧЕНИЕ-облако на плоскости лицом к камере — кома кометы. Гауссов спад без края:
 * шар с френелем давал жёсткий диск с кромкой.
 */
export function createGlowMaterial(color: number, strength: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: { uColor: { value: new Color(color) }, uStrength: { value: strength } },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  })
}
