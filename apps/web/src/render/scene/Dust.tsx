import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, LineSegments, Vector3 } from 'three'
import { makeRng } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { DUST } from '../config'
import { dustMaterial } from '../materials/materials'

/**
 * Ближняя пыль — единственный источник ощущения скорости в пустоте:
 * далёкие звёзды не смещаются, а больше зацепиться не за что.
 *
 * Частицы — отрезки, а не точки. На малой скорости отрезок короче пикселя
 * и читается как точка; на крейсерском ходу вытягивается в штрих.
 * Отдельного «режима гипердрайва» для этого не нужно.
 *
 * Частицы неподвижны в мире, но ОБОРАЧИВАЮТСЯ вокруг игрока: улетевшая назад
 * появляется впереди. Поэтому их всегда ровно DUST.COUNT.
 *
 * Хранятся они не в метрах, а в ДОЛЯХ куба, −0.5..0.5 от его центра.
 *
 * Куб растёт со скоростью (иначе штрих упирается в стенку), и это ломало
 * мировые координаты: точки, разбросанные в кубе на семьсот метров, оставались
 * в нём и после того, как куб раздувался до десяти километров. Пыль сваливалась
 * плитой набок, корабль уезжал от неё, а новую границу частица пересекала лишь
 * через десять километров пути. В долях куба такого не бывает: разброс равномерен
 * при любом размере, а рост куба лишь чуть разносит частицы — этого не видно.
 *
 * Смещение считается по ИСТИННОЙ позиции (`pos + originOffset`). Плавающее начало
 * координат телепортирует игрока на четыре километра разом, и разность локальных
 * позиций приняла бы этот скачок за полёт: вся пыль обернулась бы в одном кадре.
 */

const _true = new Vector3()
const _delta = new Vector3()

/** В долю от −0.5 до 0.5. Обёртка модульная, а не пошаговая: скачок начала координат. */
const wrapUnit = (u: number) => u - Math.round(u)

export function Dust() {
  const session = useSession()
  const ref = useRef<LineSegments>(null)

  const { geometry, offsets, previous } = useMemo(() => {
    const rng = makeRng(0x9dc51)
    const offsets = new Float32Array(DUST.COUNT * 3)
    for (let i = 0; i < DUST.COUNT * 3; i++) offsets[i] = rng() - 0.5

    // Два конца на отрезок: заранее выделено, в кадре только переписывается.
    const positions = new Float32Array(DUST.COUNT * 6)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    return { geometry: g, offsets, previous: { at: new Vector3(), known: false } }
  }, [])

  useFrame((_, dt) => {
    const mesh = ref.current
    if (!mesh) return

    const world = session.world
    const player = world.player
    const origin = player.state.pos
    const velocity = player.state.vel

    const speed = velocity.length()

    /**
     * Куб — это несколько секунд полёта, штрих — доля кадра. Оба растут со
     * скоростью, поэтому картинка не меняется ни на двухстах метрах в секунду,
     * ни на девяти гигаметрах: за кадр корабль проходит одну и ту же долю куба.
     *
     * В покое куб не схлопывается в точку: у него есть `BOX`, размер стоячей пыли.
     * Штрих держим в трети куба — тогда за гранью всегда есть куда лететь.
     */
    // Миелофон: у гигантского борта камера отъезжает на ×scale, поэтому и куб пыли, и штрих
    // растим на тот же множитель — иначе поле пыли схлопывается в точку у корабля и не видно.
    const grow = player.state.scale
    const box = Math.max(DUST.BOX, speed * DUST.BOX_SECONDS) * grow
    const streak = Math.min(speed * DUST.STREAK_SCALE * dt * grow, box * DUST.STREAK_FRACTION)

    // Хвост строится из ВЕКТОРА скорости, поэтому делим на его длину.
    const scale = speed > 1e-3 ? streak / speed : 0

    // Сколько прошёл корабль в НАСТОЯЩИХ координатах, в долях куба.
    _true.copy(origin).add(world.originOffset)
    if (!previous.known) {
      previous.at.copy(_true)
      previous.known = true
    }
    _delta.copy(_true).sub(previous.at).divideScalar(box)
    previous.at.copy(_true)

    const attribute = mesh.geometry.getAttribute('position') as BufferAttribute
    const array = attribute.array as Float32Array

    for (let i = 0; i < DUST.COUNT; i++) {
      const p = i * 3

      // Частица стоит в мире — уезжает корабль. Значит вычитаем его смещение.
      const ux = wrapUnit((offsets[p] ?? 0) - _delta.x)
      const uy = wrapUnit((offsets[p + 1] ?? 0) - _delta.y)
      const uz = wrapUnit((offsets[p + 2] ?? 0) - _delta.z)
      offsets[p] = ux
      offsets[p + 1] = uy
      offsets[p + 2] = uz

      const x = origin.x + ux * box
      const y = origin.y + uy * box
      const z = origin.z + uz * box

      const o = i * 6
      array[o] = x
      array[o + 1] = y
      array[o + 2] = z
      // Хвост тянется ПРОТИВ вектора скорости — как след на длинной выдержке.
      array[o + 3] = x - velocity.x * scale
      array[o + 4] = y - velocity.y * scale
      array[o + 5] = z - velocity.z * scale
    }

    attribute.needsUpdate = true
  })

  return <lineSegments ref={ref} geometry={geometry} material={dustMaterial()} frustumCulled={false} />
}
