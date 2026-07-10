import { useEffect, useRef, type RefObject } from 'react'

/**
 * Колесо и щипок тачпада масштабируют КАРТУ, а не окно браузера.
 *
 * React-овый `onWheel` вешается пассивным слушателем, и `preventDefault` в нём
 * молчит — поэтому щипок на тачпаде (он приходит как `wheel` с `ctrlKey`) зумил
 * всю страницу, а не карту. Нативный слушатель с `passive: false` ловит событие
 * и гасит его до браузера; заодно глушим жесты Safari (`gesture*`), которые идут
 * мимо `wheel` вовсе. `touch-action: none` снимает то же на сенсорном экране.
 *
 * Колбэк держим в ref, чтобы слушатель ставился один раз, а не на каждый рендер.
 */
export function useWheelZoom(ref: RefObject<Element | null>, onZoom: (deltaY: number) => void): void {
  const cb = useRef(onZoom)
  cb.current = onZoom

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onWheel = (e: Event) => {
      e.preventDefault()
      cb.current((e as WheelEvent).deltaY)
    }
    const stopGesture = (e: Event) => e.preventDefault()

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', stopGesture)
    el.addEventListener('gesturechange', stopGesture)
    el.addEventListener('gestureend', stopGesture)
    const prevTouch = (el as HTMLElement).style?.touchAction
    if ((el as HTMLElement).style) (el as HTMLElement).style.touchAction = 'none'

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', stopGesture)
      el.removeEventListener('gesturechange', stopGesture)
      el.removeEventListener('gestureend', stopGesture)
      if ((el as HTMLElement).style && prevTouch !== undefined) (el as HTMLElement).style.touchAction = prevTouch
    }
  }, [ref])
}
