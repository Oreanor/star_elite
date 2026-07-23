import type { Camera, WebGLRenderer, WebGLRenderTarget } from 'three'
import { blackHoleOverlayActive, renderBlackHoleOverlay } from '../scene/blackHoleOverlay'

/**
 * Pass композера: после основного RenderPass дорисовывает линзы чёрных дыр в тот же
 * буфер (`needsSwap = false`). Здесь и только здесь у линзы есть готовый кадр со всеми
 * телами и трафиком — то, что она искажает.
 */
export class BlackHolePass {
  enabled = true
  needsSwap = false
  clear = false
  renderToScreen = false

  constructor(private readonly getCamera: () => Camera) {}

  setSize(): void {}
  dispose(): void {}

  render(
    renderer: WebGLRenderer,
    _writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    if (!blackHoleOverlayActive()) return
    // После RenderPass (needsSwap) картинка в readBuffer — в него же и дорисовываем.
    // Его же depthTexture несёт глубину сцены: по ней линза отличает фон от переднего плана.
    const depth = readBuffer.depthTexture ?? null
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer)
    renderBlackHoleOverlay(renderer, this.getCamera(), depth)
  }
}
