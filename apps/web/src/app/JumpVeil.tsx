import { useEffect, useRef } from 'react'
import { jumpFx, titleAlpha, veilAlpha } from './control/jumpFx'

/**
 * Затемнение и титр прыжка — императивно, как HUD: своя петля кадра пишет прямо в
 * стиль, без единой перерисовки React. Чёрное поле гасит подмену мира между системами,
 * белый титр в центре крупно называет систему, в которую вынырнул.
 */
export function JumpVeil() {
  const veil = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const fx = jumpFx()
      if (veil.current) veil.current.style.opacity = String(veilAlpha())
      if (title.current) {
        title.current.style.opacity = String(titleAlpha())
        const name = fx.name.toUpperCase()
        if (title.current.textContent !== name) title.current.textContent = name
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <>
      <div ref={veil} className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: 0 }} />
      <div
        ref={title}
        className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center
                   text-4xl font-bold tracking-[0.35em] text-white sm:text-5xl"
        style={{ opacity: 0, textShadow: '0 0 24px rgba(120,190,255,0.6)' }}
      />
    </>
  )
}
