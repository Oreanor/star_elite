import { useEffect, useReducer } from 'react'
import type { World } from '@elite/sim'

/**
 * Перерисовать экран, когда сменился набор тел системы (`world.bodiesRevision`: тело разбито,
 * мир засеян — свой выстрел или правка журнала, пришедшая из сети). Экраны консоли не в кадре
 * сцены, поэтому сверяем счётчик редким таймером: это интерфейс, а не игровое состояние.
 */
export function useBodiesRevision(world: World): number {
  const [revision, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    let seen = world.bodiesRevision
    const id = window.setInterval(() => {
      if (world.bodiesRevision === seen) return
      seen = world.bodiesRevision
      bump()
    }, 400)
    return () => window.clearInterval(id)
  }, [world])
  return revision
}
