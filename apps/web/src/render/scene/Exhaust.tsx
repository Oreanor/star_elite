import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { AdditiveBlending, InstancedMesh, MeshBasicMaterial, Object3D, Quaternion, Vector3 } from 'three'
import { clamp, shipAxes, type ShipEntity } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { shipHidden } from '../../app/control/jumpFx'
import { EXHAUST } from '../config'
import { flameGeometry } from '../geometry/flame'
import { chassisNozzles, MISSILE_NOZZLE, type Nozzle } from '../geometry/ships'

/**
 * Струи из сопел — как у турбо-зажигалки: узкий белый керн внутри голубого факела.
 *
 * Два InstancedMesh на все сопла всех кораблей: два draw call вместо сотни.
 * Материал аддитивный и не пишет глубину — иначе факел закрыл бы корму
 * собственного корабля и всё, что за ней.
 *
 * Длина факела читается из `controls`: это тяга, форсаж и крейсер, то есть ровно
 * то, что игрок и ощущает как «газ». Мерцание — чисто рендер, физику не трогает.
 */

const MAX_FLAMES = 160

const _dummy = new Object3D()
const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()

const MISSILE_FLAME: readonly Nozzle[] = [MISSILE_NOZZLE]

function nozzlesFor(ship: ShipEntity): readonly Nozzle[] {
  return chassisNozzles(ship.loadout.chassis.id)
}

/** Насколько открыт газ, 0..1+. Крейсер зажат: на ×90 факел был бы километровым. */
function throttleOf(ship: ShipEntity): number {
  const c = ship.controls
  return c.throttle * c.boost * Math.min(c.cruise, EXHAUST.CRUISE_CLAMP)
}

interface Cone {
  geometry: ReturnType<typeof flameGeometry>
  material: MeshBasicMaterial
  /** Доли от радиуса и длины основного факела. */
  widthScale: number
  lengthScale: number
}

function makeCone(base: number, tip: number, widthScale: number, lengthScale: number): Cone {
  return {
    geometry: flameGeometry(EXHAUST.SEGMENTS, base, tip),
    material: new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
    widthScale,
    lengthScale,
  }
}

/**
 * Память о прошлой тяге и текущий всплеск — на корабль. Живёт в слое рендера,
 * потому что физике она не нужна: факел ничего не толкает.
 */
interface Surge {
  previous: number
  value: number
}

function updateSurge(surges: Map<number, Surge>, ship: ShipEntity, throttle: number, dt: number): number {
  let s = surges.get(ship.id)
  if (!s) {
    s = { previous: throttle, value: 0 }
    surges.set(ship.id, s)
  }

  // Только прибавка газа: сброс тяги факел не раздувает.
  const rise = Math.max(0, throttle - s.previous)
  s.previous = throttle
  s.value = Math.max(0, s.value - s.value * EXHAUST.SURGE_DECAY * dt) + rise * EXHAUST.SURGE_GAIN
  return s.value
}

function Flames({ cone }: { cone: Cone }) {
  const session = useSession()
  const ref = useRef<InstancedMesh>(null)
  // Оба конуса ведут свой всплеск независимо: карта дешевле, чем общий стейт.
  const surges = useRef(new Map<number, Surge>()).current

  useFrame((_, dt) => {
    const mesh = ref.current
    if (!mesh) return

    const world = session.world
    /**
     * Мерцание идёт по времени МИРА, а не по `clock.elapsedTime`. Так факел
     * замирает вместе с симуляцией под открытым меню — и заодно перестаёт
     * зависеть от частоты кадров, как и всё остальное в этой игре.
     *
     * Выходить отсюда раньше времени нельзя: `count` остался бы от прошлого кадра,
     * а на первом — равным ёмкости буфера, и в начале координат вспыхнула бы
     * сотня конусов. Поэтому мир на паузе просто отдаёт нулевой шаг.
     */
    const time = world.time
    const step = session.running ? dt : 0
    let count = 0

    /**
     * Общий вывод факелов: и корабль, и ракета — это позиция, поворот и сопла.
     * `grow` — масштаб борта (миелофон): и смещение сопел, и размер конуса растут вместе
     * с корпусом, иначе у гигантского корабля факел остаётся точкой у центра и не виден.
     */
    const emit = (pos: Vector3, quat: Quaternion, nozzles: readonly Nozzle[], length: number, grow = 1) => {
      shipAxes(quat, _fwd, _right, _up)

      for (const nozzle of nozzles) {
        if (count >= MAX_FLAMES) return
        const [x, y, z] = nozzle.offset

        _dummy.position
          .copy(pos)
          .addScaledVector(_right, x * grow)
          .addScaledVector(_up, y * grow)
          // Смещение в связанных осях, где +Z назад, а нос смотрит в −Z.
          .addScaledVector(_fwd, -z * grow)

        _dummy.quaternion.copy(quat)
        // Конус построен вдоль +Z, то есть уже назад по корпусу. Растим его длиной.
        _dummy.scale.set(
          nozzle.radius * cone.widthScale * grow,
          nozzle.radius * cone.widthScale * grow,
          nozzle.radius * length * cone.lengthScale * grow,
        )
        _dummy.updateMatrix()
        mesh.setMatrixAt(count, _dummy.matrix)
        count++
      }
    }

    const emitShip = (ship: ShipEntity) => {
      // Под полем дюзы не горят: факел выдал бы невидимку вернее корпуса. И на планетном
      // масштабе (миелофон) струи пропадают — факел размером с систему бессмыслен.
      if (!ship.alive || ship.cloaked || ship.state.scale > EXHAUST.HIDE_SCALE) {
        surges.delete(ship.id)
        return
      }
      const throttle = throttleOf(ship)
      const surge = updateSurge(surges, ship, throttle, step)
      if (throttle < 0.02 && surge < 0.02) return

      // Мерцание сдвинуто по фазе на корабль: иначе звено пульсирует в унисон.
      const flicker = 1 - EXHAUST.FLICKER + EXHAUST.FLICKER * Math.sin(time * EXHAUST.FLICKER_FREQ + ship.id)
      const length =
        (EXHAUST.IDLE_LENGTH + throttle * EXHAUST.THROTTLE_LENGTH + surge * EXHAUST.SURGE_LENGTH) * flicker

      emit(ship.state.pos, ship.state.quat, nozzlesFor(ship), length, ship.state.scale)
    }

    // Корабль игрока канул в кольцо — гасим и его факел вместе с корпусом.
    if (!shipHidden()) emitShip(world.player)
    for (const ship of world.ships) emitShip(ship)

    /**
     * Ракета сходит с пилона, зажигает ускоритель и только потом уходит вперёд.
     * Пламя идёт от ТЯГИ: пока горит ускоритель (`boostTime`), факел максимален,
     * хотя скорость ещё почти носительская. Дальше остаётся маршевый выхлоп.
     */
    for (const m of world.missiles) {
      if (!m.alive) continue

      const age = time - m.born
      const ignition = m.module.boostTime > 0 ? clamp(1 - age / m.module.boostTime, 0, 1) : 0
      const cruise = m.speed / m.module.speed

      const flicker = 1 - EXHAUST.FLICKER + EXHAUST.FLICKER * Math.sin(time * EXHAUST.FLICKER_FREQ * 1.7 + m.id)
      const length =
        (EXHAUST.MISSILE_LENGTH * cruise + EXHAUST.MISSILE_IGNITION_LENGTH * ignition + 1.2) * flicker

      emit(m.pos, m.quat, MISSILE_FLAME, length)
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[cone.geometry, cone.material, MAX_FLAMES]} frustumCulled={false} />
}

export function Exhaust() {
  // Геометрии и материалы — один раз на компонент, а не на кадр.
  const outer = useMemo(() => makeCone(EXHAUST.OUTER_BASE, EXHAUST.OUTER_TIP, 0.95, 1), [])
  const core = useMemo(() => makeCone(EXHAUST.CORE_BASE, EXHAUST.CORE_TIP, 0.42, 0.45), [])

  return (
    <>
      <Flames cone={outer} />
      <Flames cone={core} />
    </>
  )
}
