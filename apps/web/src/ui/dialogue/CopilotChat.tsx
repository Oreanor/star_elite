import { useEffect, useRef, useState } from 'react'
import { applyCommand, copilotRank, copilotSalary, type World } from '@elite/sim'
import type { ChatTurn, CopilotReply } from './facts'
import { Button, PilotPortrait } from '../station/chrome'
import { PilotIdentity } from '../station/PilotIdentity'
import { DialogueWindow, SayBar, Transcript } from './DialogueShell'
import { properName } from '../i18n/dataNames'
import { phraseText } from '../i18n/phraseText'
import { faceOfName } from '../portrait'
import { t, useLang } from '../i18n'

/**
 * Разговор со ВТОРЫМ ПИЛОТОМ (P в полёте, карточка в «Связи»). Кнопок приказов нет: всё
 * словами — «к ближайшей станции», «бей всех пиратов», «уходим отсюда», «почини щит».
 * Модель распознаёт приказ, домен исполняет (`crew/copilot.ts`) и, если не вышло, говорит
 * правду голосом пилота. Окно — то же, что у диспетчера и бота: шапка-паспорт, лента, ввод.
 */
/**
 * ПАМЯТЬ разговора со вторым пилотом — вне окна: закрыл связь и открыл снова — разговор
 * продолжается, а не начинается с «на связи». Прежде лента жила в состоянии окна и стиралась
 * каждым закрытием. Живёт `LOG_KEEP_MS` с последней реплики и не длиннее `LOG_MAX` реплик;
 * сменился пилот — память новая. Это интерфейс, не мир: часы браузера тут уместны.
 */
const LOG_KEEP_MS = 20 * 60_000
const LOG_MAX = 60
let log: { pilot: number; turns: ChatTurn[]; at: number } | null = null

function recall(pilot: number): ChatTurn[] | null {
  if (!log || log.pilot !== pilot || performance.now() - log.at > LOG_KEEP_MS) return null
  return log.turns
}

function remember(pilot: number, turns: ChatTurn[]): void {
  log = { pilot, turns: turns.slice(-LOG_MAX), at: performance.now() }
}

export function CopilotChat({
  world,
  onClose,
  negotiate,
}: {
  world: World
  onClose: () => void
  negotiate: (history: ChatTurn[], text: string) => Promise<CopilotReply>
}) {
  useLang()
  const copilot = world.copilot
  const pilotId = copilot?.acquaintanceId ?? -1
  const [turns, setTurnsRaw] = useState<ChatTurn[]>(() => recall(pilotId) ?? [{ who: 'them', text: t('copilot.hello') }])
  // Каждая смена ленты — и в память: ответ, пришедший уже после закрытия окна, тоже ляжет туда.
  const setTurns = (next: ChatTurn[] | ((list: ChatTurn[]) => ChatTurn[])) => {
    setTurnsRaw((list) => {
      const value = typeof next === 'function' ? next(list) : next
      remember(pilotId, value)
      return value
    })
  }
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [, bump] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [turns, busy])

  if (!copilot) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <Button onClick={onClose}>{t('copilot.none')}</Button>
      </div>
    )
  }

  const name = properName(copilot.name)
  const rank = copilotRank(copilot)
  const push = (turn: ChatTurn) => setTurns((list) => [...list, turn])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    const history = [...turns, { who: 'you' as const, text }]
    setTurns(history)
    setBusy(true)
    const reply = await negotiate(history, text)
    // Первая реплика — сразу («ща свяжусь с диспетчером»), исход приказов — следом.
    push({ who: 'them', text: reply.replies[0] ?? '…' })
    let ends = false
    for (const command of reply.commands) {
      const out = applyCommand(world, world.player, command)
      if (!out) continue
      if (out.spoken) push({ who: 'them', text: phraseText(out.spoken, ' ') })
      if (out.line) push({ who: 'system', text: phraseText(out.line) })
      if (out.ends) ends = true
    }
    for (const extra of reply.replies.slice(1)) push({ who: 'them', text: extra })
    setBusy(false)
    bump((n) => n + 1)
    // Уволен — с борта сошёл, говорить не с кем.
    if (ends && !world.copilot) {
      window.setTimeout(onClose, 1200)
      return
    }
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <DialogueWindow
      world={world}
      onClose={onClose}
      identity={
        <PilotIdentity
          portrait={<PilotPortrait name={copilot.name} species={copilot.persona.species} face={faceOfName(copilot.name)} size={108} />}
          name={name}
          role={t('copilot.title')}
          craft={`${t('copilot.rank', { rank })} · ${copilotSalary(rank)}`}
        />
      }
    >
      <Transcript scroller={scroller} turns={turns} myName={world.player.pilotName} theirName={name} busy={busy} />
      <SayBar inputRef={inputRef} value={input} onChange={setInput} onSend={() => void send()} busy={busy} />
    </DialogueWindow>
  )
}
