import { SRGBColorSpace, TextureLoader, type Texture } from 'three'
import type { PlanetType } from '@elite/sim'
import type { PlanetLook } from '../geometry/bodies'

/**
 * Текстуры планет. Такая же равнопромежуточная развёртка 2:1, что и у неба,
 * и ложится она на `SphereGeometry` без шва.
 *
 * У каждого ТИПА мира несколько вариантов внешности: доменных типов планет
 * пять, а выглядеть одинаково две скалистые планеты не должны. Вариант
 * выбирается по зерну планеты — то есть детерминированно, как и всё остальное
 * в генераторе: одно зерно — одна галактика, включая то, как она выглядит.
 *
 * Файла нет — остаёмся на покраске по вершинам. Это не аварийный режим:
 * процедурная планета выглядит прилично и грузится мгновенно.
 *
 * Файлы: `public/textures/planets/<тип>/<номер>.jpg`.
 */

/** Что за мир — говорит домен (`body.surface`), во что красить — знает рендер. */
const LOOK_BY_SURFACE: Record<PlanetType, PlanetLook> = {
  'Скалистая': 'rocky',
  'Ледяная': 'ice',
  'Газовый гигант': 'gas',
  'Океаническая': 'ocean',
  'Земного типа': 'terra',
}

/** Доменный тип → палитра/карта. Нет surface (луна) — скала. */
export function planetLook(surface: PlanetType | null | undefined): PlanetLook {
  return (surface && LOOK_BY_SURFACE[surface]) || 'rocky'
}

/** Сколько картинок лежит для каждого типа. Данные, а не догадка по 404. */
const VARIANTS: Record<PlanetLook, number> = {
  terra: 2,
  ocean: 2,
  ice: 2,
  rocky: 10,
  gas: 4,
}

/** Детерминированный выбор варианта. Тот же seed — та же планета, всегда. */
export function pickVariant(look: PlanetLook, seed: number): number {
  const count = VARIANTS[look]
  // Целочисленное перемешивание: младшие биты seed сами по себе почти не гуляют.
  const mixed = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  return mixed % count
}

/** URL карты поверхности — тот же путь, что грузит TextureLoader в сцене. */
export function planetTextureUrl(look: PlanetLook, variant: number): string {
  return `/textures/planets/${look}/${variant}.jpg`
}

const cache = new Map<string, Texture>()

/**
 * @param onLoaded Зовётся, если картинка нашлась. Может не позваться никогда.
 * @returns функция отписки: компонент мог размонтироваться, пока грузилось.
 */
export function loadPlanetTexture(
  look: PlanetLook,
  variant: number,
  onLoaded: (texture: Texture) => void,
): () => void {
  const key = `${look}/${variant}`

  const ready = cache.get(key)
  if (ready) {
    onLoaded(ready)
    return () => {}
  }

  let cancelled = false
  new TextureLoader().load(
    planetTextureUrl(look, variant),
    (texture) => {
      texture.colorSpace = SRGBColorSpace
      // Планета почти всегда видна ВСКОЛЬЗЬ (шар), и у лимба текстура сжимается по
      // одной оси — без анизотропии там мыло. 16 — потолок; three сам зажмёт до макс.
      texture.anisotropy = 16
      cache.set(key, texture)
      if (!cancelled) onLoaded(texture)
    },
    undefined,
    // 404 — не ошибка, а штатный случай: остаёмся на покраске по вершинам.
    () => {},
  )
  return () => {
    cancelled = true
  }
}
