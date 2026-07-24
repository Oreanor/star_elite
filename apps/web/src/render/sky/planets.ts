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
 * Файлы: `public/textures/planets/<тип>/<номер>.webp`.
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

/**
 * Сколько картинок лежит для каждого типа. Данные, а не догадка по 404.
 *
 * Число обязано совпадать с содержимым `public/textures/planets/<тип>/`, а имена
 * файлов — идти подряд с нуля: `pickVariant` берёт остаток от деления и на дырке
 * в нумерации выдаст несуществующий путь. Переложил картинку из одного типа в
 * другой — правь оба числа здесь же.
 */
const VARIANTS: Record<PlanetLook, number> = {
  terra: 12,
  ocean: 2,
  ice: 2,
  rocky: 7,
  gas: 7,
}

/** Детерминированный выбор варианта. Тот же seed — та же планета, всегда. */
export function pickVariant(look: PlanetLook, seed: number): number {
  const count = VARIANTS[look]
  // Целочисленное перемешивание: младшие биты seed сами по себе почти не гуляют.
  const mixed = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  return mixed % count
}

/**
 * Насколько подробную карту берём. Шар в сцене — `full`; кружок в клетке HUD — `lo`.
 *
 * Портрет размером в полтора десятка пикселей не различает 2048×1024, а платит за неё
 * полновесной картинкой в памяти — и вдобавок HUD ЧИТАЕТ её пиксели попиксельно
 * (`textureBall`), то есть держит ещё и распакованный кадр. Тот же приём, что у звёзд.
 */
export type PlanetTextureQuality = 'full' | 'lo'

/** URL карты поверхности — тот же путь, что грузит TextureLoader в сцене. */
export function planetTextureUrl(
  look: PlanetLook,
  variant: number,
  quality: PlanetTextureQuality = 'full',
): string {
  const dir = quality === 'lo' ? `planets/lo/${look}` : `planets/${look}`
  return `/textures/${dir}/${variant}.webp`
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
