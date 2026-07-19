import { EquirectangularReflectionMapping, SRGBColorSpace, TextureLoader, type Texture } from 'three'
import { nebulaTexture } from './nebula'

/**
 * Фоновое небо. Свойство ГАЛАКТИКИ, а не константа: в оригинальной Elite
 * галактик было восемь, и каждая выглядела иначе. Прыгнул — небо сменилось.
 *
 * Картинка обязана быть РАВНОПРОМЕЖУТОЧНОЙ развёрткой строго 2:1 (горизонталь —
 * полный оборот 360°, вертикаль — от полюса до полюса). Обычная фотография даст
 * шов за спиной и защемление на полюсах.
 *
 * Файлы: `public/sky/0.jpg` … `public/sky/9.jpg`.
 * Файла нет — остаёмся на процедурной полосе. Пустого чёрного неба не бывает.
 */

export const SKY_COUNT = 10

function normalizedSkyIndex(galaxyIndex: number): number {
  // Оборачиваем, а не падаем: галактик может стать больше, чем картинок.
  return ((galaxyIndex % SKY_COUNT) + SKY_COUNT) % SKY_COUNT
}

function skyUrl(index: number): string {
  return `/sky/${index}.jpg`
}

function configure(texture: Texture): Texture {
  texture.mapping = EquirectangularReflectionMapping
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 16 // фон уходит к горизонту вскользь — без анизотропии полоса мылит
  return texture
}

// Небо, уже показанное во второй сцене портала, после прохода обязано стать фоном
// основной сцены синхронно. Повторный TextureLoader давал кадр fallback и заметный flash.
const loaded = new Map<number, Texture>()
const loading = new Map<number, Array<(texture: Texture) => void>>()

/**
 * @param onLoaded Зовётся, если картинка нашлась. Может не позваться никогда.
 * @returns процедурный фон, готовый к показу немедленно.
 */
export function loadSky(galaxyIndex: number, onLoaded: (texture: Texture) => void): Texture {
  const index = normalizedSkyIndex(galaxyIndex)
  const ready = loaded.get(index)
  if (ready) return ready

  const listeners = loading.get(index)
  if (listeners) {
    listeners.push(onLoaded)
    return configure(nebulaTexture())
  }

  loading.set(index, [onLoaded])
  new TextureLoader().load(
    skyUrl(index),
    (texture) => {
      const readyTexture = configure(texture)
      loaded.set(index, readyTexture)
      const waiting = loading.get(index) ?? []
      loading.delete(index)
      for (const listener of waiting) listener(readyTexture)
    },
    undefined,
    // 404 — не ошибка, а штатный случай: остаёмся на процедурной полосе.
    () => loading.delete(index),
  )
  return configure(nebulaTexture())
}
