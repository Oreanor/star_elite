import type { Camera, WebGLRenderer, WebGLRenderTarget } from 'three'
import type { World } from '@elite/sim'
import { portalOpen } from '../../app/control/jumpPortal'
import { renderJumpPortalOverlay } from '../scene/portalStencil'

/**
 * Pass композера: после основного RenderPass дорисовывает stencil-портал
 * в тот же буфер (needsSwap = false).
 */
export class JumpPortalPass {
  enabled = true
  needsSwap = false
  clear = false
  renderToScreen = false

  constructor(
    private readonly getWorld: () => World,
    private readonly getCamera: () => Camera,
  ) {}

  setSize(): void {}
  dispose(): void {}

  render(
    renderer: WebGLRenderer,
    _writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    if (!portalOpen()) return
    // После RenderPass (needsSwap) картинка в readBuffer.
    const target = this.renderToScreen ? null : readBuffer
    renderer.setRenderTarget(target)
    renderJumpPortalOverlay(renderer, this.getCamera(), this.getWorld())
  }
}
