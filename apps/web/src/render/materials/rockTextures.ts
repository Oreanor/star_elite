import { SRGBColorSpace, TextureLoader, type Texture } from 'three'

/**
 * Текстуры камня. Та же равнопромежуточная развёртка 2:1, что у планет и неба:
 * `IcosahedronGeometry` наследует UV от `PolyhedronGeometry`, а та кладёт
 * сферическую развёртку без шва.
 *
 * Своя картинка на КАЖДУЮ форму, а не на камень: камни одной формы уже рисуются
 * одним InstancedMesh, и материал у них общий по определению. Разнообразие
 * даёт поворот и масштаб — и вот эти пять фотографий.
 *
 * Файла нет — остаёмся на покраске по вершинам. Это не аварийный режим:
 * гранёный крашеный камень выглядит прилично и грузится мгновенно.
 *
 * Файлы: `public/textures/asteroids/<номер формы>.webp` (1024×512, из исходников 1774×887 —
 * прежние 512×256 мутнели вблизи).
 */

/**
 * Сколько картинок камня лежит в `public/textures/asteroids`. Ими кроются не только
 * астероиды, но и ЛУНЫ: спутник — тот же камень, только крупный, и планетная карта
 * (материки, облака) на нём читалась как ошибка. Номер выводится из id тела, а не
 * бросается костью: луна, меняющая лицо при каждом входе в систему, выглядит поломкой.
 */
export const ROCK_TEXTURE_COUNT = 5

/** Какая картинка достаётся телу. Детерминировано от id — то же тело, то же лицо. */
export function rockTextureOf(id: number): number {
  return ((id % ROCK_TEXTURE_COUNT) + ROCK_TEXTURE_COUNT) % ROCK_TEXTURE_COUNT
}

const cache = new Map<number, Texture>()

/**
 * @param onLoaded Зовётся, если картинка нашлась. Может не позваться никогда.
 * @returns функция отписки: компонент мог размонтироваться, пока грузилось.
 */
export function loadRockTexture(shape: number, onLoaded: (texture: Texture) => void): () => void {
  const ready = cache.get(shape)
  if (ready) {
    onLoaded(ready)
    return () => {}
  }

  let cancelled = false
  new TextureLoader().load(
    `/textures/asteroids/${shape}.webp`,
    (texture) => {
      texture.colorSpace = SRGBColorSpace
      texture.anisotropy = 16 // камень виден вскользь у лимба — иначе мыло; three зажмёт до макс
      cache.set(shape, texture)
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
