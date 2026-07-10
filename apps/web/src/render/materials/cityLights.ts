import { AdditiveBlending, Color, FrontSide, ShaderMaterial, Vector3 } from 'three'
import { CITY_LIGHTS } from '../config'

/**
 * Огни городов на ночной стороне обитаемого мира.
 *
 * Точками их не рисуют. Точка — это спрайт с позицией, а на планету радиусом
 * 6400 км их понадобились бы тысячи: тысячи матриц, тысячи вершин, и ни одна из
 * них не переживёт того, что планета вращается. Здесь ровно та же оболочка, что
 * у атмосферы, и та же цена: один вызов отрисовки, ноль геометрии сверх сферы.
 *
 * Сетка городов считается в шейдере от НАПРАВЛЕНИЯ в связанных осях планеты
 * (`vLocal`), а не от экранных координат. Поэтому огни приклеены к поверхности:
 * планета поворачивается — они уезжают за терминатор вместе с ней, и это ровно
 * то, что видно с орбиты. Считай мы от мировой позиции, города ползли бы по
 * шару, как масляное пятно.
 *
 * Свечение аддитивное, поэтому огни ЕСТЬ всегда — просто на дневной стороне их
 * не видно за освещённой поверхностью. Маска по терминатору не «включает» их,
 * а гасит там, где они и так утонули бы: без неё яркая полоса тянулась бы через
 * полдень, где никакого города с орбиты не разглядеть.
 */

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vView;

void main() {
  // Направление из центра планеты в СВЯЗАННЫХ осях: вращение шара крутит и сетку.
  vLocal = normalize(position);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vView = normalize(cameraPosition - world.xyz);

  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`

/**
 * Ячейки — обычный хеш по целочисленной клетке. Никаких текстур: сетка городов
 * должна пережить любой радиус планеты и любое приближение камеры, а текстура
 * в 512 пикселей на полушарие расплылась бы задолго до посадки.
 */
const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uColor;
uniform vec3 uLight;
uniform float uDensity;
uniform float uCells;
uniform float uIntensity;
uniform float uTerminator;

varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vView;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

/**
 * Гладкий шум по трилинейной интерполяции. Нужен ровно для одного: люди селятся
 * не поровну. Без него огни ложатся равномерной крупой по всему шару — узор,
 * который глаз читает как шум рендера, а не как жильё. С ним появляются
 * материки: сгустки, перемычки и тёмные океаны между ними.
 */
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n00 = mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x);
  float n10 = mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x);
  float n01 = mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x);
  float n11 = mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x);

  return mix(mix(n00, n10, f.y), mix(n01, n11, f.y), f.z);
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 n = normalize(vNormal);

  // Ночь. Мягкий край: у терминатора города зажигаются, а не появляются разом.
  float night = 1.0 - smoothstep(-uTerminator, uTerminator, dot(n, normalize(uLight)));
  if (night < 0.01) discard;

  /**
   * Города жмутся к экватору: полюса — это лёд. Множитель по широте — не
   * украшение, а причина, по которой ночная Земля из космоса выглядит именно так.
   */
  float belt = 1.0 - pow(abs(vLocal.y), 1.6);

  /**
   * Обитаемая суша: два масштаба шума. Крупный лепит материки, мелкий рвёт их
   * края и разбрасывает острова — иначе получаются круглые кляксы.
   */
  float land = smoothstep(0.42, 0.66, vnoise(vLocal * 4.5) * 0.75 + vnoise(vLocal * 13.0) * 0.25);

  /**
   * Агломерации. Люди селятся не только на суше, но и ДРУГ ВОЗЛЕ ДРУГА: между
   * городами лежат поля, пустыни и горы, где ночью темно. Порог выбран так, чтобы
   * застроенным оказывалось примерно от 40 до 60 процентов суши — на глаз это
   * лоскутное одеяло, а не ровная крупа по всему полушарию.
   */
  float agglo = smoothstep(0.40, 0.62, vnoise(vLocal * 9.0 + 31.0)) * land;

  vec3 grid = vLocal * uCells;
  vec3 cell = floor(grid);
  float seed = hash(cell);

  // Порог: светится меньшинство клеток. uDensity — доля обитаемых в агломерации.
  float density = uDensity * belt * agglo;
  float lit = step(1.0 - density, seed);

  /**
   * Город стоит НЕ в центре клетки, а где придётся внутри неё, и размер у него свой.
   *
   * Клетка — лишь способ раздать каждому городу своё место, а не место само.
   * Пока огонёк сидел в середине, глаз безошибочно читал решётку: расстояния
   * между соседями были одинаковы с точностью до пропуска. Смещение — тот же
   * приём, что у шума Вороного: сетка есть, а видно её больше нет.
   */
  vec3 jitter = vec3(hash(cell + 1.7), hash(cell + 5.3), hash(cell + 9.1));
  vec3 centre = cell + 0.25 + 0.5 * jitter;
  float span = 0.10 + 0.20 * hash(cell + 2.9);
  float spark = 1.0 - smoothstep(span * 0.5, span, length(grid - centre));

  // Яркость каждого города своя: ровные по силе огни читаются как узор, а не как жильё.
  float glow = lit * spark * (0.35 + 0.65 * hash(cell + 11.3));

  /**
   * Сглаживание сетки. Клетка — девять километров, и с низкой орбиты это
   * несколько пикселей; но планета видна и с миллиона километров, где вся она
   * занимает полсотни точек. Там клетка меньше пикселя, и выборка превращается
   * в мерцающий шум: соседние кадры хватают разные города.
   *
   * fwidth говорит, насколько клетка изменилась между соседними пикселями.
   * Стала мельче пикселя — заменяем узор его же СРЕДНИМ. Это ровно то, что
   * делает мипмап у текстуры, только считать нечего: среднее известно заранее.
   */
  float footprint = fwidth(grid.x) + fwidth(grid.y) + fwidth(grid.z);
  float resolved = 1.0 - smoothstep(0.2, 0.9, footprint);
  glow = mix(density * 0.09, glow, resolved);

  // Скользящий взгляд у лимба — города видно с ребра, они тускнеют и сливаются.
  float facing = max(dot(n, normalize(vView)), 0.0);

  float alpha = glow * night * facing * uIntensity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor * alpha, alpha);
}
`

/**
 * Материал на планету, а не на цвет: `uLight` у каждой свой — как у атмосферы.
 * Плотность приходит из населения, поэтому пустая колония светится парой точек,
 * а столица в четыре миллиарда — россыпью агломераций. Это данные, а не два шейдера.
 */
export function createCityLightsMaterial(population: number): ShaderMaterial {
  // Насыщение логарифмом: от миллиона до четырёх миллиардов — три порядка, и
  // линейная шкала сделала бы всё, кроме столицы, чёрным.
  const filled = Math.min(1, Math.log10(1 + population) / Math.log10(1 + CITY_LIGHTS.FULL_AT))

  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uColor: { value: new Color(CITY_LIGHTS.COLOR) },
      uLight: { value: new Vector3(0, 0, 1) },
      uDensity: { value: CITY_LIGHTS.DENSITY * filled },
      uCells: { value: CITY_LIGHTS.CELLS },
      uIntensity: { value: CITY_LIGHTS.INTENSITY },
      uTerminator: { value: CITY_LIGHTS.TERMINATOR },
    },
    transparent: true,
    blending: AdditiveBlending,
    side: FrontSide,
    depthWrite: false,
    fog: false,
  })
}
