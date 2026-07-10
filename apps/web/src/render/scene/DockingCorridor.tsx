import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, InstancedBufferAttribute, InstancedMesh, Object3D, Vector3 } from 'three'
import { useSession } from '../../app/GameContext'
import { CORRIDOR } from '../config'
import { corridorRingGeometry } from '../geometry/props'
import { corridorMaterial } from '../materials/materials'

/**
 * Стыковочный коридор: ряд светящихся колец от корабля к причалу.
 *
 * Кольца принадлежат СТАНЦИИ, а не кораблю. Мир двигают плавающим началом
 * координат, и станция в кадре ползёт; кольца, поставленные один раз в мировых
 * координатах, уехали бы вместе с миром, а привязанные к кораблю ехали бы за
 * ним и стали бы не тоннелем, а ошейником. Поэтому меш каждый кадр садится в
 * `station.pos`, а вся расстановка живёт в его ЛОКАЛЬНЫХ осях и считается один раз.
 *
 * Ось коридора берётся в момент, когда станция дала допуск: автопилот ведёт нос
 * прямо на причал, значит корабль летит по этой самой прямой. Пересчитывать её
 * каждый кадр нельзя — коридор поворачивался бы за кораблём, и промахнуться мимо
 * него стало бы невозможно, а значит и лететь по нему стало бы незачем.
 */

const AXIS = /* @__PURE__ */ new Vector3(0, 0, 1)

const _dir = new Vector3()
const _dummy = new Object3D()
const _tint = /* @__PURE__ */ new Color(CORRIDOR.COLOR)

/**
 * Яркость кольца номер `i` в момент `time`.
 *
 * Фаза растёт со временем и с номером кольца, поэтому точка равной фазы (гребень)
 * съезжает к МЕНЬШИМ номерам — то есть к станции. Волна показывает направление
 * полёта; побеги она наружу, коридор читался бы как отчаливание.
 *
 * Степень делает гребень узким: ровный синус светился бы всем рядом сразу.
 */
function pulse(i: number, time: number): number {
  const phase = 2 * Math.PI * (time * CORRIDOR.PULSE_HZ + i * 0.11)
  const wave = 0.5 + 0.5 * Math.cos(phase)
  return 0.22 + 0.78 * wave * wave * wave
}

export function DockingCorridor() {
  const ref = useRef<InstancedMesh>(null)
  const session = useSession()

  // Цвета живут кадр за кадром, поэтому буфер выделяется один раз, как и меш.
  const colors = useMemo(() => new InstancedBufferAttribute(new Float32Array(CORRIDOR.COUNT * 3), 3), [])

  /**
   * Матрицы инстансов ставятся ОДИН РАЗ: в локальных осях меша кольца стоят вдоль
   * +Z и не двигаются никогда. Всё движение коридора — это позиция и поворот
   * самого меша, то есть две операции на кадр вместо восемнадцати.
   */
  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < CORRIDOR.COUNT; i++) {
      _dummy.position.set(0, 0, CORRIDOR.FIRST + i * CORRIDOR.SPACING)
      _dummy.quaternion.identity()
      _dummy.scale.setScalar(CORRIDOR.RADIUS)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor = colors
  }, [colors])

  /** Направление на корабль в момент выдачи допуска. Ноль — допуска не было. */
  const axis = useRef(new Vector3())

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    const world = session.world
    const station = world.bodies.find((b) => b.kind === 'station')
    const show = world.player.clearance && !world.docked && station !== undefined
    mesh.visible = show
    if (!show || !station) {
      axis.current.setScalar(0)
      return
    }

    // Первый кадр допуска: запоминаем ось захода. Дальше она неподвижна.
    if (axis.current.lengthSq() === 0) {
      _dir.copy(world.player.state.pos).sub(station.pos)
      // Корабль в самом причале оси не задаёт — берём хоть какую-то, кольца всё
      // равно не увидит: он уже стыкуется.
      axis.current.copy(_dir.lengthSq() > 1 ? _dir.normalize() : AXIS)
      mesh.quaternion.setFromUnitVectors(AXIS, axis.current)
    }

    mesh.position.copy(station.pos)

    const array = colors.array as Float32Array
    for (let i = 0; i < CORRIDOR.COUNT; i++) {
      const b = pulse(i, world.time)
      array[i * 3] = _tint.r * b
      array[i * 3 + 1] = _tint.g * b
      array[i * 3 + 2] = _tint.b * b
    }
    colors.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={ref}
      args={[corridorRingGeometry(), corridorMaterial(), CORRIDOR.COUNT]}
      visible={false}
      // Кольца стоят у станции в сотнях километров от начала координат: отсечение
      // по сфере инстансов здесь только врёт.
      frustumCulled={false}
      renderOrder={1}
    />
  )
}
