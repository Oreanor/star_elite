import { useEffect, useReducer, useRef, useState } from 'react'
import {
  applyCommand,
  assignApproach,
  assignCollectRun,
  clearTasks,
  commandableByPlayer,
  defuseGrievance,
  hasGrievance,
  hasTask,
  interlocutor,
  linesFor,
  rememberPilot,
  stanceTo,
  type AIOrder,
  type Relationship,
  type Topic,
} from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { Button, PilotPortrait } from '../station/chrome'
import { GLASS_PANEL, screenBackground } from '../station/backdrop'
import { markOutcomeEmotion, type Emotion } from '../portrait'
import { UI } from '../theme'
import { chassisName, occupationName } from '../i18n/dataNames'
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

/** Радиус сбора груза по поручению, м: бот подбирает контейнеры в этой зоне вокруг себя. */
const TASK_COLLECT_RADIUS = 4000

/** Кнопки приказов СВОЕМУ эскорту без цели — работают и без связи (по ним же зовём домен). */
const ORDER_BUTTONS: { order: AIOrder; say: string }[] = [
  { order: 'engageAll', say: 'ОГОНЬ ПО ВСЕМ' },
  { order: 'hold', say: 'ЖДИ ТУТ' },
  { order: 'keepBack', say: 'ДЕРЖИСЬ В ХВОСТЕ' },
  { order: 'standDown', say: 'ОТБОЙ, НЕ СТРЕЛЯЙ' },
  { order: 'resume', say: 'ВОЛЬНО' },
]

/** Отношение борта к игроку — одним словом в шапке. Три состояния, как `stanceTo`. */
const STANCE_WORD: Record<Relationship, string> = {
  friendly: 'ДРУЖЕЛЮБНЫЙ',
  neutral: 'НЕЙТРАЛЬНЫЙ',
  hostile: 'ВРАЖДЕБНЫЙ',
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
  const stance = stanceTo(world, other)
  // Он затаил претензию за твои попадания и вызвал по связи — можно разрядить словом.
  const owed = hasGrievance(other)
  // Это твой нанятый эскорт — ему отдают приказы послушания, а не торгуются.
  const obeys = commandableByPlayer(other, world.player.id)
  const push = (turn: ChatTurn) => setTurns((t) => [...t, turn])

  // ─ Приказ эскорту кнопкой: домен исполняет напрямую (послушание, не уговоры).
  const order = (o: AIOrder) => {
    if (ended) return
    // Приказ идёт через ту же шину, что и распознанный из речи: домен исполнит и вернёт
    // строку-подтверждение. Не подчинён/не удалось — шина даст null, кнопка промолчит.
    const out = applyCommand(world, other, { action: 'order', payload: { order: o, target: null } })
    if (!out) return
    push({ who: 'you', text: (out.line ?? '').replace('Приказ: ', '').toUpperCase() })
    push({ who: 'them', text: 'ЕСТЬ, КОМАНДИР.' })
    bump()
  }

  // ─ Поручение эскорту: не приказ послушания (бой), а ЗАДАЧА в очередь. Сбор груза —
  // канонический пример: бот летит по локатору, собирает контейнеры вокруг себя и
  // возвращается. Тот же движок очереди (`tasks.ts`), что покрыт тестами, — здесь его дверь.
  const collect = () => {
    if (ended) return
    assignCollectRun(other, other.state.pos, TASK_COLLECT_RADIUS)
    push({ who: 'you', text: 'СОБЕРИ ГРУЗ ВОКРУГ И ВЕРНИСЬ.' })
    push({ who: 'them', text: 'ПРИНЯЛ. СОБИРАЮ И ИДУ К ТЕБЕ.' })
    bump()
  }
  const dropTask = () => {
    if (ended) return
    clearTasks(other)
    push({ who: 'you', text: 'БРОСЬ ПОРУЧЕНИЕ.' })
    push({ who: 'them', text: 'ОТСТАВИЛ.' })
    bump()
  }
  // Цель навигации игрока (тело на карте/радаре) — куда послать эскорт «встань у неё».
  const navBody = world.navTargetId != null ? world.bodies.find((b) => b.id === world.navTargetId) ?? null : null
  const goToTarget = () => {
    if (ended || !navBody) return
    assignApproach(other, navBody.pos, navBody.radius)
    push({ who: 'you', text: `ЛЕТИ К ЦЕЛИ: ${navBody.name.toUpperCase()}.` })
    push({ who: 'them', text: 'ИДУ ТУДА.' })
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
    push({ who: 'you', text: line.say })
    // Заговорил — значит теперь знаком: имя открывается, и мир его запоминает. ДО команды:
    // её журнал ложится на уже существующую запись.
    rememberPilot(world, other)
    // Та же шина, что и в свободном чате. Без модели бот произносит канонную реплику домена.
    const out = applyCommand(world, other, { action: 'ask', payload: { topic } })
    push({ who: 'them', text: out?.spoken ?? '…' })
    // Исход красит лицо: сдался — грусть, сделка — радость (портрет подхватит).
    const emo = outcomeFace(topic, out?.agreed ?? false)
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

    // Разговор состоялся — запоминаем пилота ДО команд: их журнал ложится на запись.
    rememberPilot(world, other)

    // Модель разложила речь на команды {action, payload}; ИСПОЛНЯЕТ их домен — все через
    // одну шину. Соц-тон, приказ, просьба, сделка, «запомни» — здесь единый цикл, а не
    // ветка на каждый случай. Собираем исходы: подтверждения в ленту и итог просьбы.
    const outcomes = reply.commands.map((cmd) => ({ cmd, out: applyCommand(world, other, cmd) }))
    const askEntry = outcomes.find((o) => o.cmd.action === 'ask') ?? null

    // Что бот ПРОИЗНОСИТ: на согласии — живые слова модели (разнообразие); на отказе
    // просьбы — КАНОННУЮ реплику домена (`spoken`), чтобы «послал → чистого неба» не
    // случилось. Нет просьбы — просто слова модели.
    const refused = askEntry?.out?.agreed === false
    push({ who: 'them', text: refused ? (askEntry!.out!.spoken ?? reply.text) : reply.text })

    // Системные подтверждения (сделка, приказ) — следом за репликой, в порядке команд.
    for (const { out } of outcomes) if (out?.line) push({ who: 'system', text: out.line })

    // Исход просьбы красит портрет: сдался — грусть, сделка — радость.
    if (askEntry?.out) {
      const topic = (askEntry.cmd.payload as { topic: Topic }).topic
      const emo = outcomeFace(topic, askEntry.out.agreed ?? false)
      if (emo) markOutcomeEmotion(other.id, emo, world.time)
    }

    bump()
    setBusy(false)
    // Психанул или договорил — кладём трубку ПОСЛЕ его последней реплики.
    if (reply.hangup) setEnded('Собеседник отключился.')
  }

  return (
    <div
      // Фон под окном — тот же, что у консоли: у причала снимок станции (не теряем его в
      // космос), в полёте тёмное стекло с блюром поверх боя. Разговор — не отдельный мир.
      className={`absolute inset-0 flex items-center justify-center font-mono ${world.docked ? '' : 'backdrop-blur-md'}`}
      style={{ color: UI.PRIMARY, background: screenBackground(world, world.docked) }}
    >
      {/* Высота окна ФИКСИРОВАНА: лента (`flex-1`) забирает остаток и скроллится внутри,
          поэтому окно не прыгает по мере набегания реплик — растёт лишь прокрутка.
          Панель — единое «стекло» (`GLASS_PANEL`), как консоль и модалки. */}
      <div
        className="flex h-[38rem] max-h-[85vh] w-[40rem] flex-col rounded-2xl border px-8 py-6 backdrop-blur-md"
        style={{ ...GLASS_PANEL, color: UI.PRIMARY }}
      >
        {/* Слева — портрет собеседника, справа имя и статус. */}
        <div className="mb-4 flex items-center gap-4">
          <PilotPortrait ship={other} world={world} size={108} />
          <div className="min-w-0">
            {/* Порядок как на паспорте: сперва КТО он (имя, должность, корабль), и только
                ПОТОМ как он к тебе (отношение). Имя — `pilotName`, а не роль «Торговец»:
                в разговоре обращаешься к человеку; оно есть всегда, до знакомства. */}
            <div className="text-lg tracking-[0.3em]">{other.pilotName.toUpperCase()}</div>
            {/* Должность и корабль — что видно снаружи, как на плашке у причала. */}
            <div className="text-xs tracking-widest" style={{ color: UI.DIM }}>
              {occupationName(other.originKind, other.faction).toUpperCase()}
            </div>
            <div className="text-xs tracking-widest" style={{ color: UI.DIM }}>
              {chassisName(other.loadout.chassis.name).toUpperCase()}
            </div>
            {/* Отношение — последним: одно из трёх честных слов, чтобы не звать пирата
                в напарники вслепую. Отделяем сверху, это уже не «паспорт», а расклад. */}
            <div className="mt-1 text-xs tracking-widest" style={{ color: UI.PRIMARY }}>
              {STANCE_WORD[stance]}
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

                {/* Поручения (задачи в очередь) — отдельно от боевых приказов: бот уходит
                    делать дело сам. Пока один — сбор груза; движок очереди тянет и цепочки. */}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button small onClick={collect}>
                    СОБЕРИ ГРУЗ
                  </Button>
                  {navBody && (
                    <Button small onClick={goToTarget}>
                      ЛЕТИ К ЦЕЛИ
                    </Button>
                  )}
                  {hasTask(other) && (
                    <Button small onClick={dropTask}>
                      БРОСЬ ПОРУЧЕНИЕ
                    </Button>
                  )}
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
