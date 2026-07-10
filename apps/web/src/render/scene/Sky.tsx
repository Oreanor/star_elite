import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
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
