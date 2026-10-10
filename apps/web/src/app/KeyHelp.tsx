import { useEffect, useRef, useState } from 'react'
import { input, releaseLock, requestLock } from '../platform/input/input'
import { t } from '../ui/i18n'
import { KeyMap } from '../ui/keys/KeyMap'

/**
 * K — схема управления поверх ЧЕГО УГОДНО: титул, полёт, причал, карты, разговор.
 *
 * Слушатель стоит на фазе ПЕРЕХВАТА окна, раньше всех прочих: пока схема открыта,
 * клавиатура принадлежит ей целиком. Иначе Escape, закрывая схему, заодно закрыл бы
 * консоль под ней, а M/G/I переключали бы вкладки за спиной у модалки.
 *
 * В полёте схема отпускает курсор — мир встаёт, как под картой. Закрыл — захват
 * просим обратно сами: нажатие клавиши — жест пользователя, браузер это разрешает.
 * Откажет (свежий выход из захвата держит откат) — останется обычная пауза.
 */
export function KeyHelp() {
  const [open, setOpen] = useState(false)
  /** Был ли курсор захвачен до схемы — тогда и вернуть его после. */
  const relock = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Буква «к» в чате или имени пилота — это текст, а не вызов схемы.
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return

      if (!open) {
        if (e.code !== 'KeyK' || e.repeat) return
        e.preventDefault()
        e.stopImmediatePropagation()
        relock.current = input.pointerLocked
        releaseLock()
        setOpen(true)
        return
      }

      e.preventDefault()
      e.stopImmediatePropagation()
      if (!e.repeat && (e.code === 'KeyK' || e.code === 'Escape')) close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  function close() {
    setOpen(false)
    if (relock.current) void requestLock()
    relock.current = false
  }

  if (!open) return null
  return (
    <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/60 font-mono" onPointerDown={close}>
      <div
        className="flex max-h-[94vh] w-[94vw] max-w-[1700px] flex-col rounded-2xl border p-6 backdrop-blur-md"
        style={{ borderColor: 'rgba(63,115,145,0.7)', background: 'rgba(20,44,74,0.55)' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 shrink-0 border-b border-[#3f7391]/40 pb-3 text-center text-lg tracking-[0.35em] text-[#7fd6ff]">
          {t('menu.keys')}
        </div>
        <KeyMap />
      </div>
    </div>
  )
}
