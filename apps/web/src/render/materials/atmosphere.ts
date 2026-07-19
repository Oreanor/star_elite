import { AdditiveBlending, Color, FrontSide, ShaderMaterial, Vector3 } from 'three'
import { ATMOSPHERE } from '../config'

/**
 * Атмосфера — оболочка чуть больше планеты, светящаяся ТОЛЬКО на лимбе.
 *
 * Плотность идёт по френелю: чем скользнее взгляд к поверхности, тем длиннее
 * путь луча сквозь воздух. В центре диска смотришь сквозь атмосферу насквозь и
 * почти в упор — там её не видно; у края луч идёт вдоль неё сотни километров,
 * и там она белеет. Это не подгонка, а то, почему настоящий лимб выглядит так.
 *
 * Рисуется БЛИЖНЯЯ половина оболочки, поверх диска, и не пишет глубину: она
 * аддитивна, и закрывать собой планету ей нечем. Изнанкой (`BackSide`) не выйдет:
 * дальнюю половину съедает буфер глубины — её загораживает сама планета, — и от
 * атмосферы остаётся ободок в ширину зазора, то есть ничего.
 *
 * Ночная сторона не чёрная дыра: тонкий airglow на лимбе и у терминатора —
 * то самое голубое свечение земной ночи из космоса. Дневной лимб ярче и тинтится
 * спектром звезды снаружи (см. Bodies).
 *
 * Логарифмический буфер глубины подключается ЯВНО: `ShaderMaterial` не получает
 * его чанки сам, а без них оболочка планеты в ста тысячах километров начинает
 * мерцать сквозь корабль в двенадцати метрах.
 */

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vNormal;
varying vec3 vView;

void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vView = normalize(cameraPosition - world.xyz);

  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;
uniform vec3 uLight;
uniform float uPower;
uniform float uIntensity;
uniform float uTerminator;
uniform float uAirglow;
uniform float uAirglowPower;

varying vec3 vNormal;
varying vec3 vView;

void main() {
  #include <logdepthbuf_fragment>

  vec3 n = normalize(vNormal);
  vec3 L = normalize(uLight);
  float nDotL = dot(n, L);

  // Френель: единица на лимбе, ноль в центре диска.
  float rim = 1.0 - abs(dot(n, normalize(vView)));
  float density = pow(clamp(rim, 0.0, 1.0), uPower);

  // Дневной лимб с мягким терминатором.
  float day = smoothstep(-uTerminator, uTerminator, nDotL);
  float dayGlow = density * day * uIntensity;

  // Ночной airglow: тонкий лимб на тёмной половине + полоска у терминатора.
  float night = 1.0 - day;
  float nightRim = pow(clamp(rim, 0.0, 1.0), uAirglowPower) * night * uAirglow;
  float dusk = exp(-nDotL * nDotL * 14.0) * density * uAirglow * 1.1;
  float alpha = dayGlow + nightRim + dusk;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(uColor * alpha, alpha);
}
`

/**
 * Материал НА ПЛАНЕТУ, а не на цвет — единственное исключение из правила
 * «материал создаётся один раз на модуль».
 *
 * Причина в `uLight`: направление на звезду у каждой планеты своё. Общий на цвет
 * материал светил бы всем ледяным мирам системы с одной стороны — с той, куда
 * смотрит последняя из них. Планет в системе единицы, и лишний шейдер тут
 * дешевле неправильного терминатора.
 *
 * Само направление и тинт звезды обновляются в кадре записью в uniform.
 */
export function createAtmosphereMaterial(color: number): ShaderMaterial {
  const mat = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uColor: { value: new Color(color) },
      uLight: { value: new Vector3(0, 0, 1) },
      uPower: { value: ATMOSPHERE.POWER },
      uIntensity: { value: ATMOSPHERE.INTENSITY },
      uTerminator: { value: ATMOSPHERE.TERMINATOR },
      uAirglow: { value: ATMOSPHERE.AIRGLOW },
      uAirglowPower: { value: ATMOSPHERE.AIRGLOW_POWER },
    },
    transparent: true,
    blending: AdditiveBlending,
    side: FrontSide,
    depthWrite: false,
    fog: false,
  })
  // Базовый цвет типа мира — тинт звезды накладывается в кадре поверх него.
  mat.userData.baseColor = color
  return mat
}
