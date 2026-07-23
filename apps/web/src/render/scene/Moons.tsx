import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Color, InstancedMesh, Object3D, Quaternion, Vector3, type Texture } from 'three'
import type { BodyEntity } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { MOON_DECOR } from '../config'
import { moonGeometry } from '../geometry/bodies'
import { moonMaterial, moonTexturedMaterial } from '../materials/materials'
import { loadRockTexture, rockTextureOf } from '../materials/rockTextures'
import { worldShrink } from '../worldShrink'

/**
 * Мелкие луны: вся свита системы одним вызовом отрисовки.
 *
 * Они декорация — их дело показать, что планета не одинокий шар в пустоте.
 * Поэтому ни своей геометрии, ни текстуры: общая сфера, общий материал, разный
 * только оттенок. Крупные луны (Ганимед, Титан) сюда не попадают — их рисует
 * `Planet` наравне с мирами, со складками и картой поверхности.
 *
 * Луна обращается вокруг планеты (`stepOrbits` в домене) и вертится вокруг своей
 * оси. Позиция читается каждый кадр: плавающее начало координат двигает и её.
 */

const _dummy = new Object3D()
const _spin = new Quaternion()
const _tilt = new Quaternion()

/** Ось симметрии сферы в покое: полюс. Её и кладём на ось вращения луны. */
const REST_POLE = new Vector3(0, 1, 0)

/**
 * Оттенок луны выводится из её номера, а не из броска кости: спутник, меняющий
 * цвет при каждом входе в систему, выглядит поломкой. Тот же приём, что у
 * толщины атмосферы и у угла вращения — не хранить, а вычислять.
 */
function tintOf(body: BodyEntity, out: Color): Color {
  const wobble = Math.sin(body.id * 12.9898) // −1…1, детерминировано
  return out.setHex(body.color).offsetHSL(0, 0, wobble * MOON_DECOR.TINT_SPREAD)
}

/**
 * Свита кроется теми же снимками камня, что и астероиды: спутник — это камень, только
 * крупный, и планетная карта на нём читалась бы как ошибка. Картинок пять, поэтому свита
 * разбита на группы по номеру текстуры — по одному вызову отрисовки на группу вместо
 * одного на всю свиту. Лун в системе единицы, так что цена невелика, а лица у них разные.
 */
export function MoonSwarm({ moons }: { moons: readonly BodyEntity[] }) {
  const groups = useMemo(() => {
    const out = new Map<number, BodyEntity[]>()
    for (const moon of moons) {
      const shape = rockTextureOf(moon.id)
      const list = out.get(shape)
      if (list) list.push(moon)
      else out.set(shape, [moon])
    }
    return [...out.entries()]
  }, [moons])

  return (
    <>
      {groups.map(([shape, list]) => (
        <MoonGroup key={shape} shape={shape} moons={list} />
      ))}
    </>
  )
}

function MoonGroup({ shape, moons }: { shape: number; moons: readonly BodyEntity[] }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)

  const geometry = useMemo(() => moonGeometry(MOON_DECOR.SEGMENTS), [])
  // Картинка приходит поздно или не приходит вовсе: до неё луна живёт покраской
  // инстансным цветом — это не аварийный режим, а прежний облик.
  const [texture, setTexture] = useState<Texture | null>(null)
  useEffect(() => loadRockTexture(shape, setTexture), [shape])
  const material = texture ? moonTexturedMaterial(texture) : moonMaterial()

  /**
   * Цвета пишутся один раз на систему, а не в кадре: свита меняется только
   * прыжком, а прыжок пересобирает сцену целиком (`onSystemChange`).
   *
   * Колбэк-реф, а не `useEffect`: `instanceColor` рождается лишь первым вызовом
   * `setColorAt`, и делать это надо до первого кадра, иначе луны мигнут белым.
   */
  const paint = (mesh: InstancedMesh | null) => {
    ref.current = mesh
    if (!mesh) return
    const color = new Color()
    for (let i = 0; i < moons.length; i++) mesh.setColorAt(i, tintOf(moons[i]!, color))
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const shrink = worldShrink(session.world.player.state.scale)
    if (shrink <= 0) {
      mesh.count = 0
      return
    }

    const time = session.world.time
    for (let i = 0; i < moons.length; i++) {
      const body = moons[i]!
      _dummy.position.copy(body.pos)
      // Порядок важен: сначала кладём полюс на ось, потом крутим вокруг неё.
      // Иначе полюс описывает конус, и луна не вращается, а кувыркается.
      _tilt.setFromUnitVectors(REST_POLE, body.spinAxis)
      _spin.setFromAxisAngle(body.spinAxis, body.spin * time)
      _dummy.quaternion.copy(_spin).multiply(_tilt)
      // Геометрия единичного радиуса — настоящий размер задаёт масштаб.
      _dummy.scale.setScalar(body.radius * shrink)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    }

    mesh.count = moons.length
    mesh.instanceMatrix.needsUpdate = true
  })

  // Отсечение по пирамиде выключено: границы инстансов мы не считаем, а сфера
  // единичного радиуса в начале координат отсекла бы всю свиту разом.
  return <instancedMesh ref={paint} args={[geometry, material, MOON_DECOR.MAX]} frustumCulled={false} />
}
