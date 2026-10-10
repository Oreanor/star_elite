import { SRGBColorSpace, TextureLoader, type Texture } from 'three'

/**
 * Карты поверхности тел (планеты, камни, луны) — одна загрузка на URL на всю игру.
 *
 * Кэшируется ОБЕЩАНИЕ, а не готовая текстура. Иначе два потребителя одной картинки —
 * планета в сцене и та же планета на вкладке консоли — качали её дважды параллельно,
 * и вкладка, открытая сразу после входа в систему, ждала свою копию с нуля, показывая
 * плоскую покраску. Теперь второй встаёт в очередь к первому: что начала сцена, то и
 * достанется вкладке, и прогрев (`preloadSurfaceTexture`) работает на всех сразу.
 */

/** null — файла нет (404): штатный случай, тело остаётся на покраске по вершинам. */
const pending = new Map<string, Promise<Texture | null>>()
const ready = new Map<string, Texture>()

function request(url: string): Promise<Texture | null> {
  let p = pending.get(url)
  if (!p) {
    p = new Promise((resolve) => {
      new TextureLoader().load(
        url,
        (texture) => {
          texture.colorSpace = SRGBColorSpace
          // Тело почти всегда видно ВСКОЛЬЗЬ (шар), и у лимба текстура сжимается по одной
          // оси — без анизотропии там мыло. 16 — потолок; three сам зажмёт до макс.
          texture.anisotropy = 16
          ready.set(url, texture)
          resolve(texture)
        },
        undefined,
        () => resolve(null),
      )
    })
    pending.set(url, p)
  }
  return p
}

/**
 * Подписаться на карту поверхности.
 *
 * Готовая отдаётся СРАЗУ, в том же вызове: компонент, смонтированный после прогрева,
 * не должен показать ни кадра без неё.
 *
 * @param onLoaded Зовётся, если картинка нашлась.
 * @param onMissing Зовётся, если файла нет: тому, кто ждал карту, пора показать что есть.
 * @returns функция отписки: компонент мог размонтироваться, пока грузилось.
 */
export function loadSurfaceTexture(
  url: string,
  onLoaded: (texture: Texture) => void,
  onMissing?: () => void,
): () => void {
  const hit = ready.get(url)
  if (hit) {
    onLoaded(hit)
    return () => {}
  }
  let cancelled = false
  void request(url).then((texture) => {
    if (cancelled) return
    if (texture) onLoaded(texture)
    else onMissing?.()
  })
  return () => {
    cancelled = true
  }
}

/** Начать загрузку заранее, никого не подписывая. Повтор ничего не стоит. */
export function preloadSurfaceTexture(url: string): void {
  void request(url)
}
