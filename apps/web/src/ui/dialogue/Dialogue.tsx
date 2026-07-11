import { useEffect, useReducer, useRef, useState } from 'react'
import { applyOutcome, interlocutor, linesFor, rememberPilot, say, type Topic } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { Button } from '../station/chrome'
import { UI } from '../theme'
import { buildContext, type ChatTurn, type NegotiatorReply } from './facts'

/**
 * Разговор с захваченным кораблём: свободная болтовня через модель ПЛЮС кнопки
 * механик снизу — они и быстрый путь, и запас, если связь не настроена.
 *
 * Правил тут по-прежнему нет: слова механик и их исход считает домен
 * (`linesFor`/`say`/`applyOutcome`), окно лишь показывает ленту и шлёт выбор.
 * Модель — из app: её функцию прокидывают пропом, чтобы ui не звало app вверх.
 *
 * Канал не закрывается сам. Обрывают его двое: игрок (T / «положить трубку») или
 * собеседник (`hangup` — договорено, надоело или психанул). Тогда — панель обрыва.
 * Мир под окном СТОИТ (пауза = отпущенный курсор), поэтому собеседник за время
 * разговора не улетит и не погибнет: некому оборвать связь исподтишка.
 */
export function Dialogue({
  onClose,
  negotiate,
  chatAvailable,
}: {
  onClose: () => void
  negotiate: (ctx: ReturnType<typeof buildContext>, history: ChatTurn[], text: string) => Promise<NegotiatorReply>
  chatAvailable: boolean
}) {
  const session = useSession()
  const world = session.world
  const other = interlocutor(world)

  // Установка/сдача мутируют мир — счётчик заставляет кнопки догнать новое состояние.
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // Связь оборвана: причина словом. null — канал открыт.
  const [ended, setEnded] = useState<string | null>(null)

  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [turns, busy, ended])

  if (!other) {
    onClose()
    return null
  }

  const lines = linesFor(world, other)
  const hostile = other.faction === 'hostile'
  const push = (turn: ChatTurn) => setTurns((t) => [...t, turn])

  // ─ Кнопка механики: домен кидает кость и меняет мир, лента показывает обмен.
  const speak = (topic: Topic) => {
    if (ended) return
    const line = lines.find((l) => l.topic === topic)
    if (!line || line.blocked) return
    const reply = say(world, other, topic)
    push({ who: 'you', text: line.say })
    push({ who: 'them', text: reply.text })
    // Заговорил — значит теперь знаком: у пилота появляется имя, и мир его запоминает.
    rememberPilot(world, other)
    bump()
  }

  // ─ Свободная реплика: модель отвечает в характере и, поймав действие, применяем его.
  const send = async () => {
    const text = input.trim()
    if (!text || busy || ended) return
    setInput('')
    const history = turns
    push({ who: 'you', text })
    setBusy(true)

    const allowed = linesFor(world, other).filter((l) => !l.blocked).map((l) => l.topic)
    const ctx = buildContext(world, other, allowed)
    const reply = await negotiate(ctx, history, text)

    push({ who: 'them', text: reply.text })
    // Разговор состоялся — запоминаем пилота (имя, характер) на будущие встречи.
    rememberPilot(world, other)
    // Собеседник согласился на действие — домен меняет мир ровно как по кнопке.
    if (reply.intent && reply.agree) applyOutcome(world, other, reply.intent)
    bump()
    setBusy(false)
    // Психанул или договорил — кладём трубку ПОСЛЕ его последней реплики.
    if (reply.hangup) setEnded('Собеседник отключился.')
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black/80 font-mono"
      style={{ color: UI.PRIMARY }}
    >
      <div className="flex max-h-[85vh] w-[40rem] flex-col border px-8 py-6" style={{ borderColor: UI.PRIMARY }}>
        <div className="mb-1 text-lg tracking-[0.3em]">{other.name.toUpperCase()}</div>
        <div className="mb-4 text-xs tracking-widest" style={{ color: UI.DIM }}>
          {hostile ? 'ВРАЖДЕБНЫЙ' : 'МИРНЫЙ'} · {Math.round(other.state.pos.distanceTo(world.player.state.pos))} М
        </div>

        {/* Лента разговора: и болтовня, и обмен по кнопкам ложатся сюда. */}
        <div ref={scroller} className="mb-4 min-h-[8rem] flex-1 overflow-y-auto pr-1 text-sm leading-relaxed">
          {turns.length === 0 && !busy ? (
            <span style={{ color: UI.DIM }}>Канал открыт. Он слушает.</span>
          ) : (
            <div className="flex flex-col gap-2">
              {turns.map((t, i) => (
                <div key={i}>
                  {t.who === 'you' ? (
                    <span>
                      <span style={{ color: UI.DIM }}>ТЫ:&nbsp;</span>
                      {t.text}
                    </span>
                  ) : (
                    <span style={{ color: UI.PRIMARY }}>— {t.text}</span>
                  )}
                </div>
              ))}
              {busy && <span style={{ color: UI.DIM }}>…</span>}
            </div>
          )}
        </div>

        {ended ? (
          // Панель обрыва: канал закрыт, остаётся только уйти.
          <div className="border-t pt-4" style={{ borderColor: UI.DIM }}>
            <div className="mb-3 text-sm tracking-widest" style={{ color: UI.WARN }}>
              {ended}
            </div>
            <Button small onClick={onClose}>
              ЗАКРЫТЬ КАНАЛ
            </Button>
          </div>
        ) : (
          <>
            {/* Свободный ввод — только если связь настроена. Нет — одни кнопки. */}
            {chatAvailable && (
              <div className="mb-3 flex gap-2">
                <input
                  autoFocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') send()
                  }}
                  disabled={busy}
                  placeholder="Сказать что-нибудь…"
                  className="flex-1 border bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-50"
                  style={{ borderColor: UI.DIM, color: UI.PRIMARY }}
                />
                <Button small onClick={send} disabled={busy || !input.trim()}>
                  СКАЗАТЬ
                </Button>
              </div>
            )}

            {/* Кнопки механик — всегда: и быстрый путь, и запас без связи. */}
            <div className="flex flex-col items-stretch gap-2">
              {lines.map((line) => (
                <div key={line.topic} className="flex flex-col">
                  <Button small onClick={() => speak(line.topic)} disabled={line.blocked !== null || busy}>
                    {line.say}
                  </Button>
                  {line.blocked && (
                    <span className="mt-1 text-[0.65rem] tracking-widest" style={{ color: UI.DIM }}>
                      {line.blocked}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 text-center text-xs tracking-widest" style={{ color: UI.DIM }}>
              <button type="button" className="cursor-pointer hover:underline" onClick={onClose}>
                T — ПОЛОЖИТЬ ТРУБКУ
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
