import { useEffect, useRef, useState } from 'react'
import { dispatcherName, dispatcherPersona, localFine, payLocalFine, stationInterlocutor, type World } from '@elite/sim'
import type { ChatTurn, NegotiatorReply } from './facts'
import { Button, PilotPortrait } from '../station/chrome'
import { PilotIdentity } from '../station/PilotIdentity'
import { DialogueWindow, SayBar, Transcript } from './DialogueShell'
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
      setTurns([{ who: 'them', text: fine ? t('dialogue.dispatcherFine', { amount: fine.amount }) : t('dialogue.dispatcherHello') }])
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
    <DialogueWindow
      world={world}
      onClose={onClose}
      identity={
        // Тот же паспорт, что карточка диспетчера во вкладке «Люди»: имя, должность, станция.
        <PilotIdentity
          portrait={<PilotPortrait species={persona.species} face={dispatcherFace(station.name)} size={108} />}
          name={theirName}
          role={t('people.dispatcher')}
          craft={properName(station.name)}
        />
      }
    >
      <Transcript scroller={scroller} turns={turns} myName={myName} theirName={theirName} busy={busy} />
      <SayBar inputRef={inputRef} value={input} onChange={setInput} onSend={() => void send()} busy={busy} />
    </DialogueWindow>
  )
}
