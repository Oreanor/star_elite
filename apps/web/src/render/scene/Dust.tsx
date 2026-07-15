import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, LineSegments, Vector3 } from 'three'
import { makeRng } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { DUST } from '../config'
import { dustExtents, wrapUnit } from './dustMath'
import { dustMaterial } from '../materials/materials'

/**
 * Ближняя пыль — единственный источник ощущения скорости в пустоте:
 * далёкие звёзды не смещаются, а больше зацепиться не за что.
 *
 * Частицы — отрезки, а не точки. На малой скорости отрезок короче пикселя
 * и читается как точка; на крейсерском ходу вытягивается в штрих.
 * Отдельного «режима гипердрайва» для этого не нужно.
 *
 * Частицы неподвижны в мире, но ОБОРАЧИВАЮТСЯ вокруг камеры: улетевшая назад
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
 * Темп проноса считается только по ЛОКАЛЬНОЙ скорости корабля. Орбитальный перенос
 * системы отсчёта и движение камеры не являются полётом сквозь пыль.
 */

const _delta = new Vector3()

export function Dust() {
  const session = useSession()
  const ref = useRef<LineSegments>(null)

  const { geometry, offsets } = useMemo(() => {
    const rng = makeRng(0x9dc51)
    const offsets = new Float32Array(DUST.COUNT * 3)
    for (let i = 0; i < DUST.COUNT * 3; i++) offsets[i] = rng() - 0.5

    // Два конца на отрезок: заранее выделено, в кадре только переписывается.
    const positions = new Float32Array(DUST.COUNT * 6)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    return { geometry: g, offsets }
  }, [])

  useFrame(({ camera }, dt) => {
    const mesh = ref.current
    if (!mesh) return

    const world = session.world
    const player = world.player

    // За звёздным масштабом пыль гаснет: мир за потолком отвода замер, а её куб всё растёт
    // с ростом борта — на галактике он вжимается трясущейся коробкой и мельтешит. Ощущение
    // скорости там даёт сама галактика. Гасим целиком — дешевле, чем гонять мёртвый буфер.
    const dead = player.state.scale >= DUST.HIDE_SCALE
    mesh.visible = !dead
    if (dead) return

    // Это визуальное поле обязано окружать ГЛАЗ, а не центр корабля. Камера имеет
    // упреждение по скорости и кинематографическую траекторию при отчаливании;
    // привязанный к кораблю куб оставался позади, и пилот буквально влетал в него.
    const origin = camera.position
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
    // Размеры куба, штриха и темп проноса — чистой функцией (её же гоняет тест на
    // предельных скоростях). `box`/`streak` растут с масштабом борта (миелофон), а `rate`
    // (базовый куб) — нет: иначе на большом кубе иголки стоят, а не несутся.
    const { box, tail, rate } = dustExtents(speed, dt, player.state.scale)

    // Орбиты двигают локальную систему на километры в секунду, но пилот у станции
    // относительно пыли не летит. Двигаем узор только фактической скоростью борта.
    _delta.copy(velocity).multiplyScalar(dt / rate)

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
      array[o + 3] = x - velocity.x * tail
      array[o + 4] = y - velocity.y * tail
      array[o + 5] = z - velocity.z * tail
    }

    attribute.needsUpdate = true
  })

  return <lineSegments ref={ref} geometry={geometry} material={dustMaterial()} frustumCulled={false} />
}
