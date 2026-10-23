import { useFrame } from '@react-three/fiber'
import { useState } from 'react'
import { useSession } from '../../session/GameContext'

/**
 * Ревизия набора тел системы (`world.bodiesRevision`): растёт, когда тело разбито или мир
 * засеян ПОСРЕДИ визита. Сцена строит меши тел раз на систему; это единственный сигнал
 * пересобрать их. Состояние React меняется только на этом редком событии, не в кадре:
 * кадр лишь сравнивает два числа.
 */
export function useBodiesRevision(): number {
  const session = useSession()
  const [revision, setRevision] = useState(session.world.bodiesRevision)
  useFrame(() => {
    const now = session.world.bodiesRevision
    if (now !== revision) setRevision(now)
  })
  return revision
}
