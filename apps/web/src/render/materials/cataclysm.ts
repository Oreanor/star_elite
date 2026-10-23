import { AdditiveBlending, Color, DoubleSide, FrontSide, ShaderMaterial } from 'three'

/**
 * ГИБЕЛЬ МИРА — шейдеры зрелища. Четыре слоя, каждый одна вещь:
 *
 *  • ЯДРО — призрак погибшего тела: раскаляется и схлопывается внутрь, прежде чем лопнуть;
 *  • ВУАЛЬ — расширяющаяся оболочка. У газового гиганта это его же ПОЛОСЫ: атмосфера срывается
 *    полосатым покрывалом цвета мира и растворяется. У звезды — туманность из волокон;
 *  • ВСПЫШКА — билборд-ореол в миг разрыва;
 *  • КОЛЬЦО — тонкая ударная волна по экватору, бежит быстрее вуали;
 *  • ИСКРЫ — облако точек-клочьев, их полёт целиком в вершинном шейдере (CPU лишь двигает фазу).
 *
 * Всё аддитивное и без записи глубины: свет складывается с небом, а глубину проверяет —
 * планета перед взрывом заслонит его честно. Логарифмический буфер — как у всей сцены.
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
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * noise3(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}
`

const SPHERE_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObj;
varying vec3 vNormalV;
varying vec3 vView;
void main() {
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`

/** Ядро: призрак тела. `uHeat` 0..1 — от своего цвета к раскалённому; кипение поверхности. */
export function coreMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color() },
      uHot: { value: new Color() },
      uHeat: { value: 0 },
      uAlpha: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform vec3 uHot;
      uniform float uHeat;
      uniform float uAlpha;
      uniform float uTime;
      varying vec3 vObj;
      varying vec3 vNormalV;
      varying vec3 vView;
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        float facing = abs(dot(normalize(vNormalV), normalize(vView)));
        // Кипит: ячейки конвекции бегут быстрее, чем горячее тело.
        float boil = fbm(vObj * 5.0 + vec3(0.0, uTime * (0.4 + 2.0 * uHeat), 0.0));
        vec3 col = mix(uColor, uHot, clamp(uHeat * (0.6 + boil), 0.0, 1.0));
        // Лимб ярче центра: шар светится изнутри, а не освещён снаружи.
        float glow = mix(0.55, 1.0, 1.0 - facing) * (0.7 + 0.6 * boil);
        // Край размыт: к силуэту лимб тает, иначе сжимающееся тело — вырезанный резкий диск.
        glow *= smoothstep(0.0, 0.35, facing);
        gl_FragColor = vec4(col * glow * uAlpha, 1.0);
      }
    `,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  })
}

/**
 * Корона гибнущей звезды: оболочка шире ядра в `uGrow` раз. Свет — от проекции на экран:
 * над диском ядра ровный, за его краем гаснет к краю оболочки, порванный струями-протуберанцами
 * (шум по направлению, бежит во времени). Без неё сжимающаяся звезда — резкий шар без света.
 */
export function coronaMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color() },
      uHot: { value: new Color() },
      uHeat: { value: 0 },
      uAlpha: { value: 0 },
      uTime: { value: 0 },
      uGrow: { value: 2.4 },
    },
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform vec3 uHot;
      uniform float uHeat;
      uniform float uAlpha;
      uniform float uTime;
      uniform float uGrow;
      varying vec3 vObj;
      varying vec3 vNormalV;
      varying vec3 vView;
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        float facing = abs(dot(normalize(vNormalV), normalize(vView)));
        float p = sqrt(max(0.0, 1.0 - facing * facing));
        float inner = 1.0 / uGrow;
        float x = clamp((p - inner) / (1.0 - inner), 0.0, 1.0);
        // Струи: шум по направлению из центра, вытянутый наружу и бегущий во времени.
        float rays = fbm(normalize(vObj) * 4.0 + vec3(uTime * 0.25, -uTime * 0.18, 0.0));
        float fall = pow(1.0 - x, 2.0 + 2.5 * (1.0 - rays));
        // Над краем диска свет нарастает к лимбу — шов с тающим краем ядра не виден.
        float glow = p < inner ? 0.4 + 0.9 * smoothstep(inner * 0.75, inner, p) : 1.3 * fall * (0.6 + 0.8 * rays);
        vec3 col = mix(uColor, uHot, clamp(uHeat * 0.8 + 0.2, 0.0, 1.0));
        gl_FragColor = vec4(col * glow * uAlpha, 1.0);
      }
    `,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  })
}

/**
 * Вуаль: расширяющаяся оболочка. `uBands` > 0 — полосы атмосферы (газовый гигант), иначе
 * волокна туманности. `uHeat` — раскалённость в первые секунды, дальше остывает в свой цвет.
 */
export function veilMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColorA: { value: new Color() },
      uColorB: { value: new Color() },
      uHot: { value: new Color() },
      uHeat: { value: 0 },
      uAlpha: { value: 0 },
      uBands: { value: 0 },
      uTime: { value: 0 },
      uSeed: { value: 0 },
    },
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uHot;
      uniform float uHeat;
      uniform float uAlpha;
      uniform float uBands;
      uniform float uTime;
      uniform float uSeed;
      varying vec3 vObj;
      varying vec3 vNormalV;
      varying vec3 vView;
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        vec3 p = normalize(vObj);
        float facing = abs(dot(normalize(vNormalV), normalize(vView)));
        // Оболочка, снятая с любой стороны, светится КРАЕМ — сжатый фронт газа.
        float rim = pow(1.0 - facing, 2.2);
        vec3 q = p * 3.0 + vec3(uSeed, uSeed * 0.7, uTime * 0.04);
        float n = fbm(q);
        float pattern;
        vec3 col;
        if (uBands > 0.0) {
          // Полосы атмосферы, разорванные турбулентностью: широта + вихрь шума.
          float lat = p.y * uBands + n * 4.0 + fbm(q * 2.0) * 2.0;
          // Контраст полос — сильнее, чем на самой планете: тонкая вуаль иначе читается ровной.
          float band = pow(0.5 + 0.5 * sin(lat), 1.8);
          col = mix(uColorA * 0.55, uColorB * 1.35, band);
          // Покрывало рвётся: клочья и прорехи, а не сплошной шар.
          pattern = smoothstep(0.25, 0.75, fbm(q * 1.7 + 3.1)) * (0.25 + 1.3 * band);
        } else {
          // Волокна туманности: гребни шума — тонкие светящиеся жилы.
          float ridge = 1.0 - abs(fbm(q * 1.4) * 2.0 - 1.0);
          pattern = pow(ridge, 4.0) * 1.6 + 0.15 * n;
          col = mix(uColorA, uColorB, n);
        }
        col = mix(col, uHot, uHeat);
        float a = uAlpha * pattern * (0.25 + 1.4 * rim);
        gl_FragColor = vec4(col * a, 1.0);
      }
    `,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
}

/** Вспышка — билборд-ореол: яркое ядро и мягкий спад, на плоскости [-1, 1]². */
export function flashMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color() }, uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vUv);
        if (r > 1.0) discard;
        // Белое ядро в цветном ореоле, плюс четыре тонких луча — блик оптики, не звезды.
        float core = exp(-r * r * 40.0);
        float halo = pow(1.0 - r, 3.0);
        float rays = pow(max(abs(vUv.x), abs(vUv.y)) < 0.02 ? 1.0 - r : 0.0, 2.0);
        vec3 col = uColor * halo + vec3(1.0) * (core * 2.0 + rays * 0.6);
        gl_FragColor = vec4(col * uAlpha, 1.0);
      }
    `,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
}

/** Ударное кольцо по экватору: тонкий яркий фронт на круге [-1, 1]², толщина `uWidth`. */
export function ringMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color() }, uAlpha: { value: 0 }, uWidth: { value: 0.1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uWidth;
      uniform float uTime;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(vUv);
        float front = smoothstep(1.0 - uWidth, 1.0, r) * smoothstep(1.0, 0.985, r);
        // Фронт рваный: по углу яркость гуляет, кольцо — не циркульный круг.
        float ang = atan(vUv.y, vUv.x);
        float clump = 0.55 + 0.9 * noise3(vec3(cos(ang) * 6.0, sin(ang) * 6.0, uTime * 0.3));
        // Тонкий шлейф внутрь: сжатый газ за фронтом.
        float wake = smoothstep(0.4, 1.0, r) * step(r, 1.0) * 0.12;
        gl_FragColor = vec4(uColor * (front * clump + wake) * uAlpha, 1.0);
      }
    `,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
}

/**
 * Искры — облако клочьев. Атрибуты: `aDir` (единичное направление), `aSpeed` (доля разлёта),
 * `aTint` (0 — свой цвет, 1 — раскалённый). Путь — в шейдере: R·(1 + reach·speed·(1 − e^(−t/τ))).
 */
export function sparkMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uRadius: { value: 1 },
      uReach: { value: 1 },
      uAge: { value: 0 },
      uTau: { value: 1 },
      uAlpha: { value: 0 },
      uColor: { value: new Color() },
      uHot: { value: new Color() },
      uSize: { value: 2 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 aDir;
      attribute float aSpeed;
      attribute float aTint;
      uniform float uRadius;
      uniform float uReach;
      uniform float uAge;
      uniform float uTau;
      uniform float uSize;
      varying float vTint;
      varying float vFlicker;
      void main() {
        float travel = 1.0 + uReach * aSpeed * (1.0 - exp(-uAge / uTau));
        vec4 mv = modelViewMatrix * vec4(aDir * uRadius * travel, 1.0);
        vTint = aTint;
        // Мерцание у каждой искры своё — облако живёт, а не висит пылью.
        vFlicker = 0.6 + 0.4 * sin(uAge * (3.0 + aSpeed * 7.0) + aTint * 40.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (0.6 + aSpeed);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform vec3 uHot;
      uniform float uAlpha;
      varying float vTint;
      varying float vFlicker;
      void main() {
        #include <logdepthbuf_fragment>
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25) discard;
        gl_FragColor = vec4(mix(uColor, uHot, vTint) * uAlpha * vFlicker, 1.0);
      }
    `,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
}
