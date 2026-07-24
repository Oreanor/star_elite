import { SRGBColorSpace, TextureLoader, type Texture } from 'three'

/**
 * Текстуры военной базы — равнопромежуточная развёртка 2:1, ровно как у планет и камня.
 * База рисуется ГЛАДКИМ ШАРОМ (`IcosahedronGeometry` наследует сферическую UV без шва),
 * поэтому карта ложится на неё без растяжения и стыков — и твердь коллизии совпадает с
 * видимой поверхностью (см. `warBaseSolidRadius` в домене).
 *
 * Файла нет — остаёмся на матовом металле-заглушке: гладкий шар без карты всё равно лучше
 * гранёного GLB, а посадка от этого не зависит (солид = радиус в любом случае).
 *
 * Файлы: `public/textures/warbase/<shape>.webp` (2048×1024 equirect). Номер — из `shape` базы,
 * детерминированно: та же база — то же лицо.
 */

/** Сколько картинок базы лежит в `public/textures/warbase` (equirect 2:1 техно-панелей). */
export const WARBASE_TEXTURE_COUNT = 4

export function warBaseTextureOf(shape: number): number {
  return ((shape % WARBASE_TEXTURE_COUNT) + WARBASE_TEXTURE_COUNT) % WARBASE_TEXTURE_COUNT
}

const cache = new Map<number, Texture>()

/**
 * @param onLoaded Зовётся, если картинка нашлась. Может не позваться никогда (404).
 * @returns функция отписки: компонент мог размонтироваться, пока грузилось.
 */
export function loadWarBaseTexture(shape: number, onLoaded: (texture: Texture) => void): () => void {
  const key = warBaseTextureOf(shape)
  const ready = cache.get(key)
  if (ready) {
    onLoaded(ready)
    return () => {}
  }

  let cancelled = false
  new TextureLoader().load(
    `/textures/warbase/${key}.webp`,
    (texture) => {
      texture.colorSpace = SRGBColorSpace
      texture.anisotropy = 16 // база видна вскользь у лимба — иначе мыло; three зажмёт до макс
      cache.set(key, texture)
      if (!cancelled) onLoaded(texture)
    },
    undefined,
    // 404 — не ошибка, а штатный случай: остаёмся на матовом металле.
    () => {},
  )
  return () => {
    cancelled = true
  }
}
