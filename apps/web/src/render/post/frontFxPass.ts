import type { Camera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three'

/**
 * Слой ПЕРЕДНЕГО ПЛАНА без глубины: факелы сопел. Основной проход их не рисует — их
 * дорисовывает `FrontFxPass` уже ПОСЛЕ линз чёрных дыр.
 *
 * Причина: линза кладёт поверх кадра его искажённую копию и отличает передний план от фона
 * по глубине. Факел аддитивный и глубину не пишет — для линзы его нет, и вблизи дыры она
 * закрашивала струи своей картинкой. Дорисованный после, он честно стоит перед ней, а
 * глубину корпусов (по ней он прячется за кораблём) уже оставил основной проход.
 */
export const FRONT_FX_LAYER = 3

export class FrontFxPass {
  enabled = true
  needsSwap = false
  clear = false
  renderToScreen = false

  constructor(
    private readonly getScene: () => Scene,
    private readonly getCamera: () => Camera,
  ) {}

  setSize(): void {}
  dispose(): void {}

  render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    const scene = this.getScene()
    const camera = this.getCamera()
    const mask = camera.layers.mask
    const background = scene.background
    const autoClear = renderer.autoClear
    // Только слой факелов, без фона: фон уже в кадре, второй раз он закрыл бы всё.
    camera.layers.set(FRONT_FX_LAYER)
    scene.background = null
    renderer.autoClear = false
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer)
    renderer.render(scene, camera)
    renderer.autoClear = autoClear
    scene.background = background
    camera.layers.mask = mask
  }
}
