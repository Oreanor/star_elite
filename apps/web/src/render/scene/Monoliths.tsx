import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Mesh, Quaternion } from 'three'
import type { MonolithEntity } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { statueGlbGeometry, statueGlbMaterial } from '../geometry/statueGlb'

/**
 * Статуи-исполины у причала. Декорация масштаба: висят и медленно кувыркаются.
 *
 * Каждая — свой меш, без инстансинга: их ТРИ на систему, и облики у всех разные — батчить
 * нечего. Шага симуляции у них нет вовсе: угол берётся как `spin·time`, поэтому пауза их не
 * рассинхронит, а прыжок и сеть дают тот же угол при том же времени.
 */

const _spin = new Quaternion()

function Monolith({ monolith }: { monolith: MonolithEntity }) {
  const ref = useRef<Mesh>(null)
  const session = useSession()

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    // Меш грузится асинхронно — до готовности статую просто не показываем: подставлять вместо
    // километровой статуи заглушку не стоит, её было бы видно с полсистемы.
    const g = statueGlbGeometry(monolith.variant)
    const m = statueGlbMaterial(monolith.variant)
    mesh.visible = g !== null
    if (!g || !m) return
    if (mesh.geometry !== g) mesh.geometry = g
    if (mesh.material !== m) mesh.material = m

    mesh.position.copy(monolith.pos)
    // Угол ОТ ВРЕМЕНИ, а не накоплением: то же время — тот же угол.
    _spin.setFromAxisAngle(monolith.spinAxis, monolith.spin * session.world.time)
    mesh.quaternion.copy(_spin)
    mesh.scale.setScalar(monolith.radius)
  })

  return <mesh ref={ref} frustumCulled={false} />
}

export function Monoliths() {
  const session = useSession()
  return (
    <>
      {session.world.monoliths.map((m) => (
        <Monolith key={m.id} monolith={m} />
      ))}
    </>
  )
}
