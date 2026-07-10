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

function skyUrl(galaxyIndex: number): string {
  // Оборачиваем, а не падаем: галактик может стать больше, чем картинок.
  const index = ((galaxyIndex % SKY_COUNT) + SKY_COUNT) % SKY_COUNT
  return `/sky/${index}.jpg`
}

function configure(texture: Texture): Texture {
  texture.mapping = EquirectangularReflectionMapping
  texture.colorSpace = SRGBColorSpace
  return texture
}

/**
 * @param onLoaded Зовётся, если картинка нашлась. Может не позваться никогда.
 * @returns процедурный фон, готовый к показу немедленно.
 */
export function loadSky(galaxyIndex: number, onLoaded: (texture: Texture) => void): Texture {
  new TextureLoader().load(
    skyUrl(galaxyIndex),
    (texture) => onLoaded(configure(texture)),
    undefined,
    // 404 — не ошибка, а штатный случай: остаёмся на процедурной полосе.
    () => {},
  )
  return configure(nebulaTexture())
}
