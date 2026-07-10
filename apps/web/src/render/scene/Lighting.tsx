import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import { DirectionalLight, Vector3 } from 'three'
import { useSession } from '../../app/GameContext'

/**
 * Свет сцены.
 *
 * Одной звезды мало. Камера преследования смотрит кораблю В КОРМУ — то есть
 * почти всегда в его теневую сторону, — и корабль читается чёрным силуэтом.
 * При плоском шейдинге и единственном далёком источнике грани к тому же
 * получают почти одинаковый угол и перестают играть.
 *
 * Поэтому добавлен ЗАПОЛНЯЮЩИЙ свет от камеры, смещённый вбок и вверх.
 * Физически его быть не должно; без него не видно корабля.
 */

const _sunDirection = new Vector3()
const _fillOffset = new Vector3()

export function Lighting() {
  const session = useSession()
  const camera = useThree((state) => state.camera)

  const sunRef = useRef<DirectionalLight>(null)
  const fillRef = useRef<DirectionalLight>(null)

  useFrame(() => {
    const player = session.world.player.state.pos

    const sun = sunRef.current
    const star = session.world.bodies.find((b) => b.kind === 'star')
    if (sun && star) {
      // Направленному свету важно только направление. Держим источник рядом
      // с игроком, чтобы дальность не имела значения, а терминатор был верен.
      _sunDirection.copy(star.pos).sub(player).normalize()
      sun.position.copy(player).addScaledVector(_sunDirection, 1000)
      sun.target.position.copy(player)
      sun.target.updateMatrixWorld()
    }

    const fill = fillRef.current
    if (fill) {
      // Со стороны камеры, но сдвинут: строго встречный свет убил бы всю гранёность.
      _fillOffset.set(-0.55, 0.75, 1).applyQuaternion(camera.quaternion).multiplyScalar(600)
      fill.position.copy(player).add(_fillOffset)
      fill.target.position.copy(player)
      fill.target.updateMatrixWorld()
    }
  })

  return (
    <>
      {/*
       * Яркости подобраны под почти белые корпуса: с ними ключевой свет пришлось
       * убавить, иначе освещённый борт выгорает в плоское белое пятно и гранёность
       * пропадает ровно так же, как пропадала от темноты.
       */}
      <directionalLight ref={sunRef} intensity={1.9} color={0xfff2dd} />
      {/* Заполняющий: холоднее и слабее ключевого, иначе сцена станет плоской. */}
      <directionalLight ref={fillRef} intensity={0.55} color={0xa8c4e6} />
      {/* Небо сверху, отражённый свет снизу: теневая сторона перестаёт быть дырой. */}
      <hemisphereLight args={[0x4a6480, 0x141a22, 0.5]} />
    </>
  )
}
