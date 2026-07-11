import { useEffect, useReducer, useRef, useState } from 'react'
import {
  applyOrder,
  applySocial,
  applyTransfer,
  commandableByPlayer,
  defuseGrievance,
  hasGrievance,
  interlocutor,
  linesFor,
  rememberPilot,
  say,
  type AIOrder,
  type Topic,
} from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { Button, PilotPortrait } from '../station/chrome'
import { markOutcomeEmotion, type Emotion } from '../portrait'
import { UI } from '../theme'
import { occupationName } from '../i18n/dataNames'
import { buildContext, type ChatTurn, type NegotiatorReply } from './facts'

/**
 * Разговор с захваченным кораблём: свободная болтовня через модель ПЛЮС кнопки
 * механик снизу — они и быстрый путь, и запас, если связь не настроена.
 *
 * Правил тут нет и РЕШЕНИЙ тоже: и кнопки, и свободный чат считает домен (`say`).
 * Модель лишь ловит триггер (какое действие озвучил игрок) и красит слова; согласие,
 * отношение и исход — за движком, ровно как по кнопке. Оттого не бывает «послал, а
 * следом доброго пути желает»: один движок судит оба пути.
 *
 * Канал не закрывается сам. Обрывают его двое: игрок (T / «положить трубку») или
 * собеседник (`hangup` — договорено, надоело или психанул). Тогда — панель обрыва.
 * Мир под окном СТОИТ (пауза = отпущенный курсор), поэтому собеседник за время
 * разговора не улетит и не погибнет: некому оборвать связь исподтишка.
 */

/**
 * Какую эмоцию исход оставляет на лице собеседника (её подхватит портрет на пару
 * секунд). Сдался или ограблен — грусть; ударили по рукам об эскорт — радость.
 * Только на СОГЛАСИИ: отказ лица не меняет. Радость дружбы и так живёт в pilotEmotion.
 */
function outcomeFace(topic: Topic, agreed: boolean): Emotion | null {
  if (!agreed) return null
  if (topic === 'surrender' || topic === 'plunder') return 'sadness'
  if (topic === 'escort') return 'joy'
  return null
}

/** Кнопки приказов СВОЕМУ эскорту без цели — работают и без связи (по ним же зовём домен). */
const ORDER_BUTTONS: { order: AIOrder; say: string }[] = [
  { order: 'engageAll', say: 'ОГОНЬ ПО ВСЕМ' },
  { order: 'hold', say: 'ЖДАТЬ ТУТ' },
  { order: 'keepBack', say: 'ДЕРЖИСЬ В ХВОСТЕ' },
  { order: 'standDown', say: 'ОТБОЙ, НЕ СТРЕЛЯЙ' },
  { order: 'resume', say: 'ВОЛЬНО' },
]

/** Подтверждение приказа строкой в ленте (когда его распознала модель из речи). */
const ORDER_DONE: Record<AIOrder, string> = {
  attack: 'Приказ: атаковать цель.',
  engageAll: 'Приказ: огонь по всем врагам.',
  hold: 'Приказ: ждать на месте.',
  standDown: 'Приказ: отбой, прекратить огонь.',
  keepBack: 'Приказ: держаться в хвосте.',
  resume: 'Приказ: действовать как обычно.',
}

/** Итог сделки строкой для ленты. null — ничего не перешло (обещал, да нечем). */
function transferLine(r: ReturnType<typeof applyTransfer>): string | null {
  const parts: string[] = []
  if (r.units > 0 && r.commodityName) {
    parts.push(r.direction === 'toThem' ? `Передано: ${r.commodityName} ×${r.units}` : `Получено: ${r.commodityName} ×${r.units}`)
  }
  if (r.credits > 0) {
    parts.push(r.direction === 'toThem' ? `Списано: ${r.credits} кр` : `Зачислено: ${r.credits} кр`)
  }
  return parts.length ? parts.join(' · ') : null
}

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
  // Он затаил претензию за твои попадания и вызвал по связи — можно разрядить словом.
  const owed = hasGrievance(other)
  // Это твой нанятый эскорт — ему отдают приказы послушания, а не торгуются.
  const obeys = commandableByPlayer(other, world.player.id)
  const push = (turn: ChatTurn) => setTurns((t) => [...t, turn])

  // ─ Приказ эскорту кнопкой: домен исполняет напрямую (послушание, не уговоры).
  const order = (o: AIOrder) => {
    if (ended || !applyOrder(other, o)) return
    push({ who: 'you', text: ORDER_DONE[o].replace('Приказ: ', '').toUpperCase() })
    push({ who: 'them', text: 'ЕСТЬ, КОМАНДИР.' })
    bump()
  }

  // ─ Разрядить претензию: объяснился, что задел случайно. Отношение не трогаем —
  // извинение возвращает к тому, что было, а не роднит. Домен стережёт (`defuseGrievance`).
  const appease = () => {
    if (ended || !defuseGrievance(other)) return
    push({ who: 'you', text: 'ЭТО ВЫШЛО СЛУЧАЙНО. Я НЕ ЦЕЛИЛСЯ В ТЕБЯ.' })
    push({ who: 'them', text: 'ЛАДНО. НО СМОТРИ, КУДА СТРЕЛЯЕШЬ.' })
    rememberPilot(world, other)
    bump()
  }

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
    // Исход красит лицо: сдался — грусть, сделка — радость (портрет подхватит).
    const emo = outcomeFace(topic, reply.agreed)
    if (emo) markOutcomeEmotion(other.id, emo, world.time)
    bump()
  }

  // ─ Свободная реплика: модель ловит ТРИГГЕР и красит слова, а исход считает ДОМЕН.
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

    // Разговор состоялся — запоминаем пилота (имя, характер) на будущие встречи.
    rememberPilot(world, other)

    // Соц-тон реплики (нахамил/польстил) двигает отношение в данных — следствие
    // считает движок: оскорбление копит обиду (может порвать эскорт), лесть гасит её.
    if (reply.social) applySocial(world, other, reply.social)

    // Приказ послушания СВОЕМУ эскорту — домен исполняет напрямую. Стережём, что это
    // и вправду подчинённый борт: чужому приказывать нельзя, сколько бы модель ни ловила.
    if (reply.command && commandableByPlayer(other, world.player.id)) {
      applyOrder(other, reply.command, reply.commandTarget)
      push({ who: 'system', text: ORDER_DONE[reply.command] })
    }

    // Триггер есть — домен РЕШАЕТ исход и меняет мир (тот же `say`, что и кнопка,
    // взвешивает нрав и здоровье). На согласии показываем слова модели — ради
    // разнообразия; на отказе КАНОННУЮ реплику домена, чтобы «послал → чистого неба»
    // не случилось. Нет триггера — просто болтовня, слова модели как есть.
    if (reply.intent) {
      const outcome = say(world, other, reply.intent)
      push({ who: 'them', text: outcome.agreed ? reply.text : outcome.text })
      // Исход красит лицо: сдался — грусть, сделка — радость (портрет подхватит).
      const emo = outcomeFace(reply.intent, outcome.agreed)
      if (emo) markOutcomeEmotion(other.id, emo, world.time)
    } else {
      push({ who: 'them', text: reply.text })
    }

    // Сделка: передача товара/денег. Домен двигает ровно что есть и влезает.
    if (reply.transfer) {
      const r = applyTransfer(world, other, reply.transfer)
      const line = transferLine(r)
      if (line) push({ who: 'system', text: line })
    }
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
      {/* Высота окна ФИКСИРОВАНА: лента (`flex-1`) забирает остаток и скроллится внутри,
          поэтому окно не прыгает по мере набегания реплик — растёт лишь прокрутка. */}
      <div className="flex h-[38rem] max-h-[85vh] w-[40rem] flex-col border px-8 py-6" style={{ borderColor: UI.PRIMARY }}>
        {/* Слева — портрет собеседника, справа имя и статус. */}
        <div className="mb-4 flex items-center gap-4">
          <PilotPortrait ship={other} world={world} size={108} />
          <div className="min-w-0">
            {/* Имя пилота (`pilotName`), а не роль «Торговец»: в разговоре ты обращаешься
                к человеку. Оно дано при рождении и есть всегда, до всякого знакомства. */}
            <div className="text-lg tracking-[0.3em]">{other.pilotName.toUpperCase()}</div>
            {/* Род занятий — СРАЗУ, до всякого приглашения: чтобы не звать в напарники
                пирата вслепую. Внешне читаемое, метагейма нет. */}
            <div className="text-xs tracking-widest" style={{ color: UI.DIM }}>
              {occupationName(other.originKind, other.faction).toUpperCase()} · {hostile ? 'ВРАЖДЕБНЫЙ' : 'МИРНЫЙ'} · {Math.round(other.state.pos.distanceTo(world.player.state.pos))} М
            </div>
          </div>
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
                  ) : t.who === 'system' ? (
                    <span className="text-xs tracking-widest" style={{ color: UI.WARN }}>
                      · {t.text} ·
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

            {/* Разрядка — только пока претензия открыта: он вызвал, ты объясняешься.
                Стоит над механиками и выделена: это ответ на входящий вызов. */}
            {owed && (
              <div className="mb-2">
                <Button small onClick={appease}>
                  ЭТО ВЫШЛО СЛУЧАЙНО — РАЗРЯДИТЬ
                </Button>
              </div>
            )}

            {/* Приказы эскорту — когда собеседник тебе подчинён. Работают без связи:
                кнопка зовёт тот же домен, что и распознанный из речи приказ. */}
            {obeys && (
              <div className="mb-3">
                <div className="mb-1 text-xs tracking-widest" style={{ color: UI.DIM }}>
                  ПРИКАЗ ЭСКОРТУ
                </div>
                <div className="flex flex-wrap gap-2">
                  {ORDER_BUTTONS.map((b) => (
                    <Button key={b.order} small onClick={() => order(b.order)}>
                      {b.say}
                    </Button>
                  ))}
                </div>
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
