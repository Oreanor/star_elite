import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Vector2 } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { BLOOM } from '../config'

/**
 * Свечение ярких мест. Звезда, дюзы, болты лазеров и взрывы засвечивают кадр —
 * то, что в фотографии называют ореолом вокруг пересвета.
 *
 * Дёшево не потому, что эффект дешёвый, а потому, что кадр МАЛЕНЬКИЙ: игра
 * рисуется во внутреннем разрешении (`PIXEL_SCALE`), и пять проходов размытия
 * идут по буферу в несколько раз меньше экрана. Настоящая цена — на телефоне
 * с полным разрешением, и там `PIXEL_SCALE` её и снимает.
 *
 * Порог высокий: светиться обязано только то, что раскалено. Уронишь порог —
 * засветится обшивка, и низкополигональная гранёность утонет в молоке.
 *
 * Кадр рисует КОМПОЗЕР, а не R3F. Любой `useFrame` с приоритетом выше нуля
 * отключает автоматическую отрисовку, и рисовать обязаны мы сами.
 */
export function Post() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)

  const composer = useMemo(() => {
    const c = new EffectComposer(gl)
    c.addPass(new RenderPass(scene, camera))
    c.addPass(
      new UnrealBloomPass(new Vector2(1, 1), BLOOM.STRENGTH, BLOOM.RADIUS, BLOOM.THRESHOLD),
    )
    return c
  }, [gl, scene, camera])

  // Композер держит свои цели рендера: они обязаны совпасть с внутренним буфером,
  // а не с размером окна. Иначе картинка растянется дважды.
  useEffect(() => {
    composer.setSize(size.width, size.height)
    composer.setPixelRatio(dpr)
  }, [composer, size, dpr])

  useEffect(() => () => composer.dispose(), [composer])

  // Приоритет 1: после HUD и симуляции, последним в кадре.
  useFrame(() => composer.render(), 1)

  return null
}
