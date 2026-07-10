import { BufferAttribute, BufferGeometry, Color, IcosahedronGeometry, SphereGeometry, Vector3 } from 'three'
import { makeRng } from '@elite/sim'

/**
 * Планеты и звёзды.
 *
 * Планета — единственное в игре, что НЕ гранёное. Гранёный корабль читается как
 * низкополигональный стиль; гранёная планета читается как ошибка: глаз знает,
 * что шар размером в тысячи километров не бывает многогранником. Поэтому здесь
 * сфера с гладкими нормалями и покраской ПО ВЕРШИНАМ, а не по граням.
 *
 * Сфера, а не икосфера: у неё правильная равнопромежуточная развёртка, и на неё
 * ложится та же 2:1 картинка, что и на небо. Икосфера дала бы шов.
 *
 * Терминатор — линию дня и ночи — рисует один направленный свет от звезды.
 * Отдельно его программировать не нужно, он выпадает сам.
 *
 * Геометрия единичного радиуса; настоящий размер задаёт масштаб меша.
 */

const _v = new Vector3()
const _color = new Color()

export type PlanetLook = 'rocky' | 'ice' | 'ocean' | 'gas' | 'terra'

interface Palette {
  low: number
  high: number
  pole: number
  /** Полосы по широте: юпитерианский вид почти даром. */
  banded: boolean
}

const LOOKS: Record<PlanetLook, Palette> = {
  rocky: { low: 0x6b5a4a, high: 0x8b7a63, pole: 0x9a9188, banded: false },
  ice: { low: 0x7d99ad, high: 0xc3d8e6, pole: 0xf0f7fb, banded: false },
  ocean: { low: 0x1d4a6b, high: 0x2f7ba6, pole: 0xdfeaf0, banded: false },
  gas: { low: 0x8a6a4a, high: 0xc7a173, pole: 0x9c8464, banded: true },
  terra: { low: 0x2e6b3f, high: 0x5f8f52, pole: 0xe8f2f5, banded: false },
}

/**
 * @param segments Меридианов. 160×105 — это 34 тысячи треугольников на планету;
 *                 их в системе единицы, и рисуется каждая одним вызовом.
 *
 *                 Столько нужно из-за настоящего масштаба: с орбиты в 500 км
 *                 планета радиусом 6371 км занимает почти всё небо, и её силуэт
 *                 идёт краем экрана. Гранёный шар размером с Землю читается как
 *                 ошибка — ровно то, чего эта геометрия и должна избегать.
 */
function planetShape(look: PlanetLook, seed: number, segments: number): BufferGeometry {
  const geometry = new SphereGeometry(1, segments, Math.round(segments * 0.66))
  const position = geometry.getAttribute('position') as BufferAttribute
  const palette = LOOKS[look]

  const rng = makeRng(seed)
  // Дешёвая замена шума: три случайные «складки» по направлениям.
  const axes = Array.from({ length: 3 }, () =>
    new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize(),
  )
  const phases = [rng() * 6.28, rng() * 6.28, rng() * 6.28]

  const low = new Color(palette.low)
  const high = new Color(palette.high)
  const pole = new Color(palette.pole)

  const colors = new Float32Array(position.count * 3)

  // Цвет на ВЕРШИНУ, а не на грань: между вершинами он интерполируется,
  // и поверхность выходит гладкой без единого лишнего треугольника.
  for (let i = 0; i < position.count; i++) {
    _v.fromBufferAttribute(position, i).normalize()
    const latitude = Math.abs(_v.y)

    let value: number
    if (palette.banded) {
      // Полосы по широте, слегка изломанные — иначе выглядят как штрихкод.
      value = 0.5 + 0.5 * Math.sin(_v.y * 11 + Math.sin(_v.x * 3) * 0.6)
    } else {
      value = 0
      for (let a = 0; a < axes.length; a++) {
        value += Math.sin(_v.dot(axes[a]!) * (2.5 + a * 1.7) + phases[a]!)
      }
      value = 0.5 + value / 6
    }

    _color.lerpColors(low, high, Math.min(1, Math.max(0, value)))

    // Шапки полюсов. У газового гиганта их нет.
    if (!palette.banded && latitude > 0.82) {
      _color.lerp(pole, Math.min(1, (latitude - 0.82) / 0.14))
    }

    colors[i * 3] = _color.r
    colors[i * 3 + 1] = _color.g
    colors[i * 3 + 2] = _color.b
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
  return geometry
}

const cache = new Map<string, BufferGeometry>()

export function planetGeometry(look: PlanetLook, seed: number, segments = 160): BufferGeometry {
  const key = `${look}:${seed}:${segments}`
  let geometry = cache.get(key)
  if (!geometry) {
    geometry = planetShape(look, seed, segments)
    cache.set(key, geometry)
  }
  return geometry
}

const moonCache = new Map<number, BufferGeometry>()

/**
 * Общий шарик для мелких лун. ОДНА геометрия на всю галактику: они рисуются
 * инстансами, и своя сфера каждой не нужна — им не положено отличаться формой.
 *
 * Нормали гладкие, как у планеты: гранёный спутник читался бы как ошибка, а не
 * как стиль. Цвета по вершинам нет — оттенок приходит инстансным цветом, иначе
 * все луны системы вышли бы одинаковыми до пикселя.
 *
 * Кэш по числу меридианов, а не одиночка: одиночка приняла бы `segments` первого
 * вызова и молча выбросила у всех следующих — та же ловушка, что у `starMaterial`.
 */
export function moonGeometry(segments: number): BufferGeometry {
  let geometry = moonCache.get(segments)
  if (!geometry) {
    geometry = new SphereGeometry(1, segments, Math.round(segments * 0.66))
    moonCache.set(segments, geometry)
  }
  return geometry
}

let starCache: BufferGeometry | null = null

/** Звезда: гладкая сфера. Её всё равно рисуют без освещения, гранить нечего. */
export function starGeometry(): BufferGeometry {
  starCache ??= new IcosahedronGeometry(1, 4)
  return starCache
}

let atmosphereCache: BufferGeometry | null = null

/**
 * Оболочка атмосферы. Гладкая сфера чуть больше планеты: гранёный лимб выдал бы
 * многоугольник там, где глаз ищет дугу, — а лимб здесь и есть весь эффект.
 */
export function atmosphereGeometry(): BufferGeometry {
  atmosphereCache ??= new SphereGeometry(1, 96, 48)
  return atmosphereCache
}
