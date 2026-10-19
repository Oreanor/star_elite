import { useEffect, useRef, useState } from 'react'
import { input, releaseLock, requestLock } from '../platform/input/input'
import { useSession } from '../session/GameContext'
import { torusTuning, torusTuningSnippet } from '../render/scene/torusTuning'

/**
 * F4 в комнате-гиперторе — ползунки облика: яркость галактик, яркость рёбер, раздвижка узлов.
 * Панель в углу, а не модалка: крутишь и сразу видишь комнату. Как схема клавиш (K), отпускает
 * курсор на время и возвращает захват по закрытию. Значения пишутся в `torusTuning`, кадр
 * читает их сам — React в кадре не участвует, только перерисовывает подписи у ползунков.
 */
const SLIDERS = [
  { key: 'puff', label: 'ГАЛАКТИКИ', min: 0, max: 1.5, step: 0.01 },
  { key: 'dot', label: 'РЁБРА', min: 0, max: 1.5, step: 0.01 },
  { key: 'spread', label: 'РАЗДВИЖКА', min: 1, max: 30, step: 0.5 },
] as const

/** Открытость панели держит App: пока она открыта, меню паузы не должно закрыть комнату. */
export function TorusTuner({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const session = useSession()
  const [, bump] = useState(0)
  const [copied, setCopied] = useState(false)
  const relock = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) {
        if (e.code !== 'F4' || e.repeat || !session.bush.active) return
        e.preventDefault()
        e.stopImmediatePropagation()
        relock.current = input.pointerLocked
        releaseLock()
        setOpen(true)
        return
      }
      if (e.code === 'F4' || e.code === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (!e.repeat) close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, session, setOpen])

  function close() {
    setOpen(false)
    setCopied(false)
    if (relock.current) void requestLock()
    relock.current = false
  }

  if (!open) return null
  return (
    <div
      className="absolute right-4 top-4 z-[65] w-72 space-y-3 rounded-lg border p-4 font-mono text-xs tracking-widest"
      style={{ borderColor: 'rgba(63,115,145,0.7)', background: 'rgba(10,26,47,0.85)', color: '#7fd6ff' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {SLIDERS.map((s) => (
        <label key={s.key} className="block">
          <div className="mb-1 flex justify-between">
            <span>{s.label}</span>
            <span>{torusTuning[s.key].toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={s.min}
            max={s.max}
            step={s.step}
            value={torusTuning[s.key]}
            onChange={(e) => {
              torusTuning[s.key] = Number(e.target.value)
              setCopied(false)
              bump((n) => n + 1)
            }}
            className="w-full cursor-pointer accent-[#7fd6ff]"
          />
        </label>
      ))}
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(torusTuningSnippet()).then(() => setCopied(true))}
        className="w-full cursor-pointer border px-3 py-1.5"
        style={{ borderColor: '#7fd6ff' }}
      >
        {copied ? 'СКОПИРОВАНО' : 'КОПИРОВАТЬ'}
      </button>
    </div>
  )
}
