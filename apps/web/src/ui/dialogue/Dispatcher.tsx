import { useEffect, useRef, useState } from 'react'
import { dispatcherPersona, localFine, payLocalFine, stationInterlocutor, type World } from '@elite/sim'
import type { ChatTurn, NegotiatorReply } from './facts'
import { ACCENT, Button, DIM, PilotPortrait } from '../station/chrome'
import { properName, speciesName } from '../i18n/dataNames'
import { t, useLang } from '../i18n'

function faceOf(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % 36
}

export function Dispatcher({ world, onClose, negotiate }: { world: World; onClose: () => void; negotiate: (history: ChatTurn[], text: string) => Promise<NegotiatorReply> }) {
  useLang()
  const station = stationInterlocutor(world)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (station && turns.length === 0) {
      const fine = localFine(world)
      setTurns([{ who: 'them', text: fine ? `Диспетчер на связи. За вами долг ${fine.amount} кредитов местной власти. Если хотите оплатить — скажите прямо.` : 'Диспетчер на связи. Говори.' }])
    }
  }, [station, turns.length])
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }) }, [turns, busy])

  if (!station) return <div className="absolute inset-0 flex items-center justify-center"><Button onClick={onClose}>{t('dispatcher.off')}</Button></div>

  const persona = dispatcherPersona(world, station)
  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    const next = [...turns, { who: 'you' as const, text }]
    setTurns(next)
    setBusy(true)
    const reply = await negotiate(next, text)
    let answer = reply.text
    for (const command of reply.commands) {
      if (command.action !== 'fine' || typeof command.payload !== 'object' || command.payload === null) continue
      const confirm = (command.payload as { confirm?: unknown }).confirm
      if (confirm !== true) continue
      const paid = payLocalFine(world)
      answer = paid.ok ? `${answer}\nПлатёж принят: ${paid.amount} кредитов.` : `Оплатить сейчас нельзя: требуется ${paid.amount} кредитов.`
    }
    setTurns((current) => [...current, { who: 'them', text: answer }])
    setBusy(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center font-mono" style={{ color: ACCENT }}>
      <div className="flex h-[38rem] max-h-[85vh] w-[40rem] flex-col rounded-2xl border px-8 py-6 backdrop-blur-md" style={{ borderColor: 'rgba(124,196,255,0.3)', background: 'linear-gradient(150deg, rgba(40,95,150,0.18), rgba(8,22,42,0.5))' }}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <PilotPortrait species={persona.species} face={faceOf(station.name)} size={96} />
            <div>
              <div className="text-lg tracking-[0.2em]">{t('dispatcher.title', { station: properName(station.name).toUpperCase() })}</div>
              <div className="text-xs tracking-widest" style={{ color: DIM }}>{speciesName(persona.species).toUpperCase()}</div>
            </div>
          </div>
          <Button small onClick={onClose}>{t('dialogue.end')}</Button>
        </div>
        <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto border-y px-2 py-4">
          {turns.map((turn, index) => <div key={`${index}-${turn.who}`} className={turn.who === 'you' ? 'text-right' : ''}><span className="inline-block max-w-[85%] rounded border px-3 py-2 text-sm" style={{ borderColor: turn.who === 'you' ? ACCENT : DIM, color: turn.who === 'you' ? ACCENT : '#cfe8ff' }}>{turn.text}</span></div>)}
          {busy && <div className="text-xs tracking-widest" style={{ color: DIM }}>…</div>}
        </div>
        <div className="mt-4 flex gap-2">
          <input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void send() }} disabled={busy} autoFocus className="min-w-0 flex-1 border bg-transparent px-3 py-2 text-sm outline-none" style={{ borderColor: DIM, color: ACCENT }} placeholder="Сказать диспетчеру…" />
          <Button small onClick={() => void send()} disabled={busy || !input.trim()}>ОТПРАВИТЬ</Button>
        </div>
      </div>
    </div>
  )
}
