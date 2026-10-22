import { BELT, configureAsteroidBelt } from '@elite/sim'
import { useEffect, useRef, useState } from 'react'
import { input, releaseLock, requestLock } from '../platform/input/input'
import { useSession } from '../session/GameContext'
import { torusTuning, torusTuningSnippet } from '../render/scene/torusTuning'

/**
 * F4 в комнате-гиперторе — ползунки облика, три группы: узлы, рёбра, общее.
 * Панель в углу, а не модалка: крутишь и сразу видишь комнату. Как схема клавиш (K), отпускает
 * курсор на время и возвращает захват по закрытию. Значения пишутся в `torusTuning`, кадр
 * читает их сам — React в кадре не участвует, только перерисовывает подписи у ползунков.
 */
const GROUPS = [
  {
    title: 'УЗЛЫ',
    sliders: [
      { key: 'puff', label: 'ЯРКОСТЬ', min: 0, max: 3, step: 0.01 },
      { key: 'puffSize', label: 'РАЗМЕР', min: 0.2, max: 8, step: 0.01 },
      { key: 'jetLength', label: 'ДЛИНА ДЖЕТА', min: 0, max: 24, step: 0.1 },
      { key: 'jetBody', label: 'ТЕЛО ДЖЕТА', min: 0, max: 4, step: 0.01 },
    ],
  },
  {
    title: 'РЁБРА',
    sliders: [
      { key: 'edge', label: 'ЯРКОСТЬ', min: 0, max: 3, step: 0.01 },
      { key: 'thickness', label: 'ТОЛЩИНА', min: 0.1, max: 10, step: 0.05 },
      { key: 'blur', label: 'РАЗМЫТОСТЬ', min: 0.15, max: 4, step: 0.01 },
      { key: 'curvature', label: 'КРИВИЗНА', min: 0, max: 2, step: 0.01 },
    ],
  },
  {
    title: 'ОБЩЕЕ',
    sliders: [{ key: 'spread', label: 'РАЗДВИЖКА', min: 1, max: 30, step: 0.5 }],
  },
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
        if (e.code !== 'F4' || e.repeat || (!session.bush.active && !session.world.asteroidBelt)) return
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
  if (!session.bush.active) {
    const belt = session.world.asteroidBelt
    if (!belt) return null
    return <div className="absolute right-4 top-4 z-[65] w-80 space-y-4 rounded-lg border p-4 font-mono text-xs" style={{ background: '#0a1a2feb', color: '#7fd6ff' }}>
      <div>АСТЕРОИДНЫЙ ПОЯС · F4</div>
      <label className="block">ДИАМЕТР ТРУБЫ: {(belt.diameter / 1000).toFixed(1)} км
        <input className="w-full" type="range" min={BELT.DIAMETER_MIN} max={BELT.DIAMETER_MAX} step={500} value={belt.diameter} onChange={e => { configureAsteroidBelt(session.world, Number(e.target.value), belt.count); bump(n => n + 1) }} />
      </label>
      <label className="block">КАМНЕЙ В ДУГЕ ЛОКАТОРА: ≈{belt.count}
        <input className="w-full" type="range" min={BELT.COUNT_MIN} max={BELT.COUNT_MAX} step={25} value={belt.count} onChange={e => { configureAsteroidBelt(session.world, belt.diameter, Number(e.target.value)); bump(n => n + 1) }} />
      </label>
      <div className="opacity-60">В радиусе 30 км на оси пояса. Точки видны до 100 км. Настройки действуют в текущей системе.</div>
      <button className="w-full border p-2" onClick={close}>ЗАКРЫТЬ</button>
    </div>
  }
  return (
    <div
      className="absolute right-4 top-4 z-[65] max-h-[calc(100%-2rem)] w-72 space-y-4 overflow-y-auto rounded-lg border p-4 font-mono text-xs tracking-meta"
      style={{ borderColor: 'rgba(63,115,145,0.7)', background: 'rgba(10,26,47,0.85)', color: '#7fd6ff' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {GROUPS.map((group) => (
        <div key={group.title} className="space-y-3">
          <div className="border-b pb-1" style={{ borderColor: 'rgba(63,115,145,0.7)', color: 'rgba(127,214,255,0.55)' }}>
            {group.title}
          </div>
          {group.sliders.map((s) => (
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
        </div>
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
