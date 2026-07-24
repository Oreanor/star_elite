import { AdditiveBlending, BackSide, Color, DoubleSide, ShaderMaterial, type Side } from 'three'

/**
 * ПЛАЗМЕННАЯ СТРУЯ непрерывного лучемёта. Не тонкая трасса болта, а колонна света в
 * обхват кабины — так центральный ствол виден с кормовой камеры, где он бьёт от нас и
 * тонкий луч сливается в точку.
 *
 * Труба живая: вершины гуляют синусом поперёк оси (две волны с разной частотой, чтобы
 * рисунок не читался как правильная спираль), а яркость дышит по времени. Всё в вершинном
 * шейдере: трясти матрицами на CPU значило бы пересобирать их каждый кадр на каждую струю.
 *
 * Два слоя, один материал: ЯДРО почти белое и плотное, ОБОЛОЧКА — цветная, с френелем
 * (край трубы ярче центра, как у любого свечения в объёме) и рисуется изнутри тоже.
 * Оба аддитивны — это свет, а не тело, и они складываются, а не перекрывают.
 *
 * `logdepthbuf_*` в обоих шейдерах ОБЯЗАТЕЛЕН и снимать его нельзя. Сцена рисуется с
 * логарифмическим буфером глубины (`RENDER.LOG_DEPTH`, иначе звезда в 1200 км и корабль
 * в 12 м не уживаются в одном кадре), и три подменяет им запись глубины. Свой шейдер без
 * этих чанков пишет глубину по обычной формуле — в другой шкале, чем вся остальная сцена,
 * и тест глубины сравнивает несравнимое: струя била СКВОЗЬ планету, поверх лимба.
 */

/** Волна: как часто (радиан на длину луча) и насколько (в долях радиуса). */
const WAVE_FREQ = 34
const WAVE_AMP = 0.28
/** Скорость бега волны и дыхания яркости, рад/с. */
const WAVE_SPEED = 9
const PULSE_SPEED = 26

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float uTime;
  uniform float uAmp;
  varying vec3 vNormalV;
  varying vec3 vViewV;
  varying float vAlong;

  void main() {
    /* Единичный цилиндр вытянут вдоль Z: position.z идёт 0..1 по длине струи. */
    float along = position.z + 0.5;
    vAlong = along;

    vec3 p = position;
    p.x += sin(along * ${WAVE_FREQ.toFixed(1)} + uTime * ${WAVE_SPEED.toFixed(1)}) * uAmp;
    p.y += cos(along * ${(WAVE_FREQ * 0.77).toFixed(1)} + uTime * ${(WAVE_SPEED * 1.3).toFixed(1)}) * uAmp * 0.7;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
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
  uniform float uTime;
  uniform float uFresnel;
  uniform float uStrength;
  varying vec3 vNormalV;
  varying vec3 vViewV;
  varying float vAlong;

  void main() {
    #include <logdepthbuf_fragment>

    /* Френель: у оболочки светится КРАЙ трубы, у ядра — вся толща (uFresnel=0). */
    float rim = 1.0 - abs(dot(normalize(vNormalV), normalize(vViewV)));
    float shell = mix(1.0, pow(rim, 1.6) * 1.9, uFresnel);

    /* Дыхание яркости + бегущие сгустки вдоль струи: живая плазма, а не трубка. */
    float pulse = 0.86 + 0.14 * sin(uTime * ${PULSE_SPEED.toFixed(1)});
    float clots = 0.9 + 0.1 * sin(vAlong * 60.0 - uTime * 30.0);

    /* Хвост чуть гаснет к концу — струя тает, а не обрывается ножом. */
    float fade = 1.0 - 0.25 * smoothstep(0.72, 1.0, vAlong);

    gl_FragColor = vec4(uColor * shell * pulse * clots * fade * uStrength, 1.0);
  }
`

function beamMaterial(color: number, fresnel: number, strength: number, side: Side): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: WAVE_AMP },
      uColor: { value: new Color(color) },
      uFresnel: { value: fresnel },
      uStrength: { value: strength },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side,
  })
}

let core: ShaderMaterial | null = null
let shell: ShaderMaterial | null = null

/** Ядро: почти белое, светит всей толщей. Один материал на все струи в кадре. */
export function beamCoreMaterial(): ShaderMaterial {
  core ??= beamMaterial(0xeaf7ff, 0, 1.15, DoubleSide)
  return core
}

/** Оболочка: цвет ствола, светится краем. Изнутри (BackSide) — чтобы труба была полой. */
export function beamShellMaterial(): ShaderMaterial {
  shell ??= beamMaterial(0x3a9dff, 1, 0.9, BackSide)
  return shell
}

/** Обе оболочки живут по общему времени: волна на ядре и на шубе обязана совпадать. */
export function stepBeamMaterials(time: number): void {
  if (core) core.uniforms.uTime!.value = time
  if (shell) shell.uniforms.uTime!.value = time
}
