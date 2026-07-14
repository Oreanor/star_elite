import { loadSheet, sheetReady } from './portrait'

/** PNG титульной заставки: фон, лого, корабль и три струи. */
export const TITLE_ASSETS = [
  '/bg.png',
  '/logo.png',
  '/ship.png',
  '/flame_left.png',
  '/flame_right.png',
  '/flame_center.png',
] as const

let titlePreload: Promise<void> | null = null

/** Одна картинка в кэш; 404 не блокирует — заставка всё равно откроется. */
function loadImage(url: string): Promise<void> {
  const img = loadSheet(url)
  if (sheetReady(img)) return Promise.resolve()
  return new Promise((resolve) => {
    img.onload = () => resolve()
    img.onerror = () => resolve()
  })
}

/** Прогреть список URL; опционально — сколько уже готово. */
export function preloadImages(
  urls: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = urls.length
  if (total === 0) {
    onProgress?.(0, 0)
    return Promise.resolve()
  }
  let done = 0
  const tick = () => {
    done += 1
    onProgress?.(done, total)
  }
  return Promise.all(
    urls.map((url) =>
      loadImage(url).finally(tick),
    ),
  ).then(() => {})
}

export function imageReady(url: string): boolean {
  return sheetReady(loadSheet(url))
}

export function titleAssetsReady(): boolean {
  return TITLE_ASSETS.every(imageReady)
}

/** Прогрев титульной графики; повторный вызов — тот же Promise. */
export function preloadTitleAssets(onProgress?: (done: number, total: number) => void): Promise<void> {
  if (titleAssetsReady()) {
    onProgress?.(TITLE_ASSETS.length, TITLE_ASSETS.length)
    return Promise.resolve()
  }
  if (!titlePreload) titlePreload = preloadImages(TITLE_ASSETS, onProgress)
  else if (onProgress) {
    return titlePreload.then(() => onProgress(TITLE_ASSETS.length, TITLE_ASSETS.length))
  }
  return titlePreload
}
