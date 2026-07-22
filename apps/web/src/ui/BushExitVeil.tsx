import { useEffect, useRef } from 'react'
import { bushExitVeil } from '../app/control/bushExit'

/**
 * ПЕЛЕНА ВЫХОДА ИЗ КОМНАТЫ. Чёрный лист поверх кадра, из которого выедается растущая круглая
 * прорезь: сквозь неё проявляется уже подменённый мир. Край прорези сначала совсем размыт, к
 * концу становится резким — мягче, чем шторка, и не выглядит вырезанным ножницами.
 *
 * DOM, а не HUD-канвас: HUD рисуется в низком внутреннем разрешении и крупным пикселем, а
 * плавный градиент на 320 пикселях в ширину развалился бы на ступеньки. Переход — не прибор,
 * общей пиксельной сетки с 3D ему не нужно.
 *
 * React в анимации не участвует: состояние читается в rAF и пишется прямо в `style`.
 */
export function BushExitVeil() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = ref.current
      if (!el) return
      const { dark, hole, soft } = bushExitVeil()
      if (dark <= 0) {
        if (el.style.opacity !== '0') el.style.opacity = '0'
        return
      }
      el.style.opacity = String(dark)
      // Прорезь: прозрачно до `hole`, дальше чернота, а между ними мягкая полоса `soft`.
      // Проценты — от полудиагонали, поэтому 100% с запасом накрывает угол экрана.
      const inner = Math.max(0, hole * 100)
      const outer = Math.max(inner + 0.5, (hole + soft) * 100)
      const mask = `radial-gradient(circle at 50% 50%, transparent ${inner}%, #000 ${outer}%)`
      el.style.maskImage = mask
      el.style.webkitMaskImage = mask
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 z-[55] bg-black"
      style={{ opacity: 0 }}
    />
  )
}
