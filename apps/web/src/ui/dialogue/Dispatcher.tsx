import { useEffect, useRef, useState } from 'react'
import { dispatcherName, dispatcherPersona, localFine, payLocalFine, stationInterlocutor, type World } from '@elite/sim'
import type { ChatTurn, NegotiatorReply } from './facts'
import { Button, PilotPortrait } from '../station/chrome'
import { GLASS_PANEL, screenBackground } from '../station/backdrop'
import { UI } from '../theme'
import { PilotIdentity } from '../station/PilotIdentity'
import { properName } from '../i18n/dataNames'
import { t, useLang } from '../i18n'

/** Лицо диспетчера — по названию станции; одно и то же в окне связи и в карточке «Люди». */
export function dispatcherFace(name: string): number {
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

  // Окно — ТО ЖЕ, что разговор с пилотом (`Dialogue`): фон станции/стекло, панель
  // `GLASS_PANEL`, шапка-паспорт, лента «Имя: реплика», поле ввода под чертой. Прежде у
  // диспетчера была своя вёрстка с пузырями, и связь с ним выглядела другим приложением.
  const myName = world.player.pilotName
  const theirName = dispatcherName(world, station)
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center font-mono ${world.docked ? '' : 'backdrop-blur-md'}`}
      style={{ color: UI.PRIMARY, background: screenBackground(world, world.docked) }}
    >
      <div
        className="flex h-[38rem] max-h-[85vh] w-[40rem] flex-col rounded-2xl border px-8 py-6 backdrop-blur-md"
        style={{ ...GLASS_PANEL, color: UI.PRIMARY }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          {/* Тот же паспорт, что карточка диспетчера во вкладке «Люди»: имя, должность, станция. */}
          <PilotIdentity
            portrait={<PilotPortrait species={persona.species} face={dispatcherFace(station.name)} size={108} />}
            name={theirName}
            role={t('people.dispatcher')}
            craft={properName(station.name)}
          />
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Button small onClick={onClose}>
              {t('dialogue.end')}
            </Button>
          </div>
        </div>

        <div ref={scroller} className="mb-4 min-h-[8rem] flex-1 overflow-y-auto pr-1 text-sm leading-relaxed">
          <div className="flex flex-col gap-2">
            {turns.map((turn, i) => (
              <div key={i}>
                {turn.who === 'you' ? (
                  <span>
                    <span style={{ color: UI.DIM }}>{myName}:&nbsp;</span>
                    {turn.text}
                  </span>
                ) : turn.who === 'system' ? (
                  <span className="text-xs tracking-widest" style={{ color: UI.WARN }}>
                    · {turn.text} ·
                  </span>
                ) : (
                  <span>
                    <span style={{ color: UI.PRIMARY }}>{theirName}:&nbsp;</span>
                    {turn.text}
                  </span>
                )}
              </div>
            ))}
            {busy && <span style={{ color: UI.DIM }}>…</span>}
          </div>
        </div>

        <div className="flex gap-2 border-t pt-4" style={{ borderColor: UI.DIM }}>
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send()
            }}
            disabled={busy}
            placeholder={t('chat.placeholder')}
            className="flex-1 border bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-50"
            style={{ borderColor: UI.DIM, color: UI.PRIMARY }}
          />
          <Button small onClick={() => void send()} disabled={busy || !input.trim()}>
            {t('chat.send')}
          </Button>
        </div>
      </div>
    </div>
  )
}
