import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { clamp } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { SKY } from '../config'
import { loadSky } from '../sky/sky'

/**
 * Фон сцены. Не геометрия: three рисует `scene.background` одним полноэкранным
 * проходом за всей сценой — без вершин, без глубины, бесконечно далеко.
 *
 * Ничего не рендерит сам.
 */
export function Sky({ galaxyIndex = 0 }: { galaxyIndex?: number }) {
  const scene = useThree((state) => state.scene)
  const session = useSession()

  /**
   * Миелофон: пока борт растёт к галактическому масштабу, скайбокс ТУХНЕТ — фон гаснет
   * от полной яркости к нулю между FADE_START и FADE_END, освобождая кадр под галактику.
   * Гасим только ФОН: окружение (карту отражений металла) держим, иначе корпус чернеет.
   * Пишем каждый кадр напрямую в сцену — ноль перерисовок React.
   */
  useFrame(() => {
    const scale = session.world.player.state.scale
    const t = clamp((scale - SKY.FADE_START_SCALE) / (SKY.FADE_END_SCALE - SKY.FADE_START_SCALE), 0, 1)
    scene.backgroundIntensity = SKY.INTENSITY * (1 - t)
  })

  useEffect(() => {
    // Процедурная полоса появляется сразу; настоящая картинка подменит её, когда придёт.
    const fallback = loadSky(galaxyIndex, (texture) => {
      scene.background = texture
      scene.environment = texture
    })
    scene.background = fallback
    // То же небо — карта окружения. Металл без неё чёрный: отражать нечего.
    // three сам пережуёт равнопромежуточную текстуру в PMREM, один раз при подмене.
    scene.environment = fallback
    scene.backgroundIntensity = SKY.INTENSITY
    scene.environmentIntensity = SKY.ENVIRONMENT_INTENSITY

    return () => {
      scene.background = null
      scene.environment = null
    }
  }, [scene, galaxyIndex])

  return null
}
