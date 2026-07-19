import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Vector2, WebGLRenderTarget } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { useSession } from '../../app/GameContext'
import { BLOOM, ZOOM_BLUR, ZOOM_FX, ZOOM_RIPPLE } from '../config'
import { ZoomBlurShader } from './zoomBlur'
import { ZoomRippleShader } from './zoomRipple'
import { JumpPortalPass } from './portalPass'
import { activeWorldRenderScene } from '../scene/jumpPortalWorld'

/**
 * Свечение + zoom-fx + stencil-портал прыжка.
 * Кадр рисует композер (приоритет 1). Буферы со stencil — иначе маска портала мертва.
 */
export function Post() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const session = useSession()
  const strength = useRef(0)
  const time = useRef(0)

  const { composer, renderPass, blurPass, ripplePass } = useMemo(() => {
    const sz = gl.getDrawingBufferSize(new Vector2())
    const rt = new WebGLRenderTarget(sz.x, sz.y, { stencilBuffer: true })
    const c = new EffectComposer(gl, rt)
    // Второй буфер композера тоже со stencil (EffectComposer клонирует параметры).
    c.renderTarget2.stencilBuffer = true

    const render = new RenderPass(scene, camera)
    c.addPass(render)

    const portal = new JumpPortalPass(
      () => session.world,
      () => camera,
    )
    c.addPass(portal as never)

    const blur = new ShaderPass(ZoomBlurShader)
    blur.uniforms.amount!.value = ZOOM_BLUR.AMOUNT
    blur.enabled = false
    c.addPass(blur)

    const ripple = new ShaderPass(ZoomRippleShader)
    ripple.uniforms.amount!.value = ZOOM_RIPPLE.AMOUNT
    ripple.uniforms.freq!.value = ZOOM_RIPPLE.FREQ
    ripple.uniforms.speed!.value = ZOOM_RIPPLE.SPEED
    ripple.uniforms.fall!.value = ZOOM_RIPPLE.FALL
    ripple.enabled = false
    c.addPass(ripple)

    c.addPass(
      new UnrealBloomPass(new Vector2(1, 1), BLOOM.STRENGTH, BLOOM.RADIUS, BLOOM.THRESHOLD),
    )
    return { composer: c, renderPass: render, blurPass: blur, ripplePass: ripple }
  }, [gl, scene, camera, session])

  useEffect(() => {
    composer.setSize(size.width, size.height)
    composer.setPixelRatio(dpr)
  }, [composer, size, dpr])

  useEffect(() => () => composer.dispose(), [composer])

  useFrame((_, dt) => {
    const clamped = Math.min(dt, 0.05)
    const want = Math.abs(session.world.player.controls.grow) > 0 ? 1 : 0
    const rate = want > strength.current ? ZOOM_FX.ATTACK : ZOOM_FX.DECAY
    const k = 1 - Math.exp(-rate * clamped)
    strength.current += (want - strength.current) * k
    if (strength.current < 1e-4) strength.current = 0

    const s = strength.current
    const visual = s > 0 ? s ** ZOOM_FX.GAMMA : 0
    const on = visual > 0.002
    blurPass.enabled = on
    blurPass.uniforms.strength!.value = visual
    ripplePass.enabled = on
    ripplePass.uniforms.strength!.value = visual
    if (on) {
      time.current += clamped
      ripplePass.uniforms.time!.value = time.current
    }

    gl.localClippingEnabled = true
    renderPass.scene = activeWorldRenderScene(scene, session.world)
    composer.render()
  }, 1)

  return null
}
