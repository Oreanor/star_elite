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
 * Файлы: `public/asteroids/<номер формы>.jpg`.
 */

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
    `/asteroids/${shape}.jpg`,
    (texture) => {
      texture.colorSpace = SRGBColorSpace
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
