import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect } from 'react'
import { clamp } from '@elite/sim'
import { useSession } from '../../session/GameContext'
import { SKY } from '../config'
import { loadSky } from '../sky/sky'

/** Доля затухания фона при этом росте: 0 — полный, 1 — погас. По логарифму, с плавными краями. */
function skyFade(scale: number): number {
  const from = Math.log(SKY.FADE_START_SCALE)
  const to = Math.log(SKY.FADE_END_SCALE)
  const x = clamp((Math.log(Math.max(scale, 1e-9)) - from) / Math.max(to - from, 1e-9), 0, 1)
  return x * x * (3 - 2 * x)
}

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
  useFrame((_, dt) => {
    // КОМНАТА ТОРА — математическая пустота: скайбокса нет. Гасим фон в ноль (окружение
    // для металла оставляем — иначе корпус корабля почернеет).
    if (session.bush.active) {
      scene.backgroundIntensity = 0
      return
    }
    const target = SKY.INTENSITY * (1 - skyFade(session.world.player.state.scale))
    // Плавно догоняем цель: скачок роста колесом не должен гасить фон за один кадр.
    const k = 1 - Math.exp(-SKY.FADE_RATE * Math.min(dt, 0.1))
    scene.backgroundIntensity += (target - scene.backgroundIntensity) * k
  })

  useLayoutEffect(() => {
    // Процедурная полоса появляется сразу; настоящая картинка подменит её, когда придёт.
    // Layout-effect обязателен при handoff портала: новая основная Scene получает уже
    // прогретую текстуру до следующего WebGL-кадра, без промежуточного background=null.
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
