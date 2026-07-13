import { useFrame } from '@react-three/fiber'
import { advanceUndock } from '../../app/control/undockFx'

/**
 * Постановщик кино вылета: единственная забота — крутить время сцены. Мир при
 * отчаливании не подменяется (в отличие от прыжка), поэтому директор может жить
 * прямо в сцене. Монтируется рано — до камеры и HUD, чтобы те в этом же кадре
 * читали уже сдвинутое время. Камеру и маску рисуют FlightCamera и drawUndock.
 */
export function UndockDirector() {
  useFrame((_, dt) => advanceUndock(dt))
  return null
}
