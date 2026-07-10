import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import { DirectionalLight, Vector3 } from 'three'
import type { BodyEntity } from '@elite/sim'
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

/**
 * Какая звезда светит. У одиночной выбор очевиден; у двойной свет и терминатор
 * задаёт БЛИЖАЙШАЯ — среди пары корабль освещает то солнце, к которому подошёл,
 * а не то, что первым попалось в списке тел.
 */
function litBy(world: ReturnType<typeof useSession>['world'], from: Vector3): BodyEntity | null {
  let best: BodyEntity | null = null
  let nearest = Infinity
  for (const body of world.bodies) {
    if (body.kind !== 'star') continue
    const d = body.pos.distanceToSquared(from)
    if (d < nearest) {
      nearest = d
      best = body
    }
  }
  return best
}

export function Lighting() {
  const session = useSession()
  const camera = useThree((state) => state.camera)

  const sunRef = useRef<DirectionalLight>(null)
  const fillRef = useRef<DirectionalLight>(null)

  useFrame(() => {
    const player = session.world.player.state.pos

    const sun = sunRef.current
    const star = litBy(session.world, player)
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
