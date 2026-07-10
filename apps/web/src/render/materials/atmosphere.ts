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
 * Центр диска при этом не светится: там взгляд перпендикулярен поверхности, и
 * френель даёт ноль. Свечение появляется само там, где ему и место, — на лимбе.
 *
 * Ночная сторона тёмная: множитель — освещённость по нормали, с мягким
 * терминатором. Иначе планета получала бы кольцо вокруг всего диска, включая ту
 * половину, куда звезда не светит, и терминатор, честно посчитанный светом,
 * тонул бы в этом кольце.
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

varying vec3 vNormal;
varying vec3 vView;

void main() {
  #include <logdepthbuf_fragment>

  vec3 n = normalize(vNormal);

  // Френель: единица на лимбе, ноль в центре диска.
  float rim = 1.0 - abs(dot(n, normalize(vView)));
  float density = pow(clamp(rim, 0.0, 1.0), uPower);

  // Освещённость с мягким терминатором: воздух светится и чуть за краем тени —
  // там, где солнце уже село для поверхности, но ещё видно с высоты.
  float lit = smoothstep(-uTerminator, uTerminator, dot(n, normalize(uLight)));

  float alpha = density * lit * uIntensity;
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
 * Само направление обновляется в кадре записью в uniform. React в этом не
 * участвует: менять проп ради движения света — это перерисовка дерева на кадр.
 */
export function createAtmosphereMaterial(color: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uColor: { value: new Color(color) },
      uLight: { value: new Vector3(0, 0, 1) },
      uPower: { value: ATMOSPHERE.POWER },
      uIntensity: { value: ATMOSPHERE.INTENSITY },
      uTerminator: { value: ATMOSPHERE.TERMINATOR },
    },
    transparent: true,
    blending: AdditiveBlending,
    side: FrontSide,
    depthWrite: false,
    fog: false,
  })
}
