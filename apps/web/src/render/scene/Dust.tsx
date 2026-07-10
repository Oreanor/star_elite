import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, LineSegments, Vector3 } from 'three'
import { makeRng, wrapAround } from '@elite/sim'
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
 * Обёртка обязана быть МОДУЛЬНОЙ, а не пошаговой: плавающее начало координат
 * телепортирует игрока на FLOATING_ORIGIN_RADIUS (4 км) разом, а вычитание одного
 * BOX (700 м) за кадр возвращало пыль только за шесть кадров. Всё это время
 * единственный источник ощущения скорости висел вне куба и дёргался по 700 м —
 * читалось как удар о невидимую стену раз в двадцать секунд.
 */

const _delta = new Vector3()

export function Dust() {
  const session = useSession()
  const ref = useRef<LineSegments>(null)

  const { geometry, points } = useMemo(() => {
    const rng = makeRng(0x9dc51)
    const points = new Float32Array(DUST.COUNT * 3)
    for (let i = 0; i < DUST.COUNT * 3; i++) points[i] = (rng() - 0.5) * DUST.BOX

    // Два конца на отрезок: заранее выделено, в кадре только переписывается.
    const positions = new Float32Array(DUST.COUNT * 6)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    return { geometry: g, points }
  }, [])

  useFrame((_, dt) => {
    const mesh = ref.current
    if (!mesh) return

    const player = session.world.player
    const origin = player.state.pos
    const velocity = player.state.vel

    const speed = velocity.length()

    /**
     * Куб растёт вместе со скоростью, штрих — вместе с кубом.
     *
     * Иначе штрих упирается в стенку: на крейсере ×30 он подбирался к семистам
     * метрам постоянного куба, частицы оборачивались прямо в кадре, и пыль
     * читалась коробкой вокруг корабля. Держим штрих в трети куба — тогда за
     * гранью всегда есть куда лететь.
     *
     * Выше `SPEED_CAP` не растёт ничего: пыль там всё равно слилась в рябь.
     * Это ограничение ЗРЕНИЯ, а не двигателя — физика о нём не знает.
     */
    const shown = Math.min(speed, DUST.SPEED_CAP)
    const box = DUST.BOX * (1 + shown / DUST.BOX_SPEED)
    const streak = Math.min(shown * DUST.STREAK_SCALE * dt, box * DUST.STREAK_FRACTION)

    // Хвост строится из ВЕКТОРА скорости, поэтому делим на настоящую длину,
    // а не на урезанную: направление обязано остаться точным.
    const scale = speed > 1e-3 ? streak / speed : 0

    const attribute = mesh.geometry.getAttribute('position') as BufferAttribute
    const array = attribute.array as Float32Array

    for (let i = 0; i < DUST.COUNT; i++) {
      const p = i * 3

      // Оборачиваем частицу в куб вокруг игрока. Без этого пыль остаётся позади.
      for (let axis = 0; axis < 3; axis++) {
        const index = p + axis
        points[index] = wrapAround(points[index] ?? 0, origin.getComponent(axis), box)
      }

      const x = points[p] ?? 0
      const y = points[p + 1] ?? 0
      const z = points[p + 2] ?? 0

      // Хвост тянется ПРОТИВ вектора скорости — как след на длинной выдержке.
      _delta.copy(velocity).multiplyScalar(-scale)

      const o = i * 6
      array[o] = x
      array[o + 1] = y
      array[o + 2] = z
      array[o + 3] = x + _delta.x
      array[o + 4] = y + _delta.y
      array[o + 5] = z + _delta.z
    }

    attribute.needsUpdate = true
  })

  return <lineSegments ref={ref} geometry={geometry} material={dustMaterial()} frustumCulled={false} />
}
