import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
  dialogueEffects,
  escortFee,
  interlocutor,
  linesFor,
  rememberPilot,
  stanceTo,
  type Command,
  type Relationship,
  type Topic,
} from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { Button, PilotPortrait } from '../station/chrome'
import { GLASS_PANEL, screenBackground } from '../station/backdrop'
import { clearOutcomeEmotion, markOutcomeEmotion, type DivineEmotion, type Emotion } from '../portrait'
import { UI } from '../theme'
import { chassisName, occupationName } from '../i18n/dataNames'
import { t, useLang, type Key } from '../i18n'
import { buildContext, createDigestMemory, rememberDigest, sufflerDigestsFor, type ChatTurn, type ContextDigest, type DigestMemory, type NegotiatorReply } from './facts'
import { DIALOGUE_REACTION_MS, dialogueBaseline, dialogueReaction } from './dialogueFace'

/** Суфлёр: тихая подгрузка справочников в промпт — без паузы в ленте. */

/**
 * Разговор с захваченным кораблём: свободная болтовня через модель плюс «НАНЯТЬ»
 * в эскорт, если связь не настроена или нужен быстрый путь.
 *
 * Правил тут нет и РЕШЕНИЙ тоже: и кнопка, и свободный чат считает домен (`say`).
 * Модель ловит триггер и красит слова; согласие, отношение и исход — за движком.
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

/** Применить команды и положить реплики в ленту (кнопка и LLM — один контур). */
function applyTurnToChat(
  push: (turn: ChatTurn) => void,
  world: ReturnType<typeof useSession>['world'],
  other: NonNullable<ReturnType<typeof interlocutor>>,
  youText: string,
  commands: Command[],
  replyText = '',
): ReturnType<typeof dialogueEffects> {
  push({ who: 'you', text: youText })
  const fx = dialogueEffects(world, other, commands, replyText)
  push({ who: 'them', text: fx.them })
  for (const line of fx.system) push({ who: 'system', text: line })
  return fx
}

/** Отношение борта к игроку — одним словом в шапке. Три состояния, как `stanceTo`. */
const STANCE_KEY: Record<Relationship, Key> = {
  friendly: 'dialogue.stance.friendly',
  neutral: 'dialogue.stance.neutral',
  hostile: 'dialogue.stance.hostile',
}

const STANCE_COLOR: Record<Relationship, string> = {
  friendly: UI.ALLY,
  neutral: UI.DIM,
  hostile: UI.DANGER,
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
  useLang()
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
  const inputRef = useRef<HTMLInputElement>(null)
  /** Справочники в памяти разговора — старые выпадают, когда открывают новые. */
  const digestMemory = useRef<DigestMemory>(createDigestMemory())
  /** Лицо в шапке — своё, не `pilotEmotion`: претензия и пауза мира не должны залипать. */
  const [faceEmo, setFaceEmo] = useState<Emotion>('neutral')
  /** Мимика бога Слова, ВЫЗВАННАЯ им самим (поле `emotion` в ответе). null — по настроению. */
  const [divineFace, setDivineFace] = useState<DivineEmotion | null>(null)
  const faceDecay = useRef<number | null>(null)

  const resetFace = useCallback(() => {
    if (!other) return
    setFaceEmo(dialogueBaseline(world, other))
    setDivineFace(null)
  }, [world, other])

  const reactFace = useCallback((commands: Command[], fx: ReturnType<typeof dialogueEffects>) => {
    const hit = dialogueReaction(commands, fx)
    if (!hit) return
    setFaceEmo(hit)
    if (faceDecay.current !== null) window.clearTimeout(faceDecay.current)
    faceDecay.current = window.setTimeout(resetFace, DIALOGUE_REACTION_MS)
  }, [resetFace])

  useEffect(() => {
    if (other) setFaceEmo(dialogueBaseline(world, other))
  }, [world, other])

  useEffect(() => {
    if (!other) return
    const id = other.id
    return () => {
      if (faceDecay.current !== null) window.clearTimeout(faceDecay.current)
      clearOutcomeEmotion(id)
    }
  }, [other?.id])

  /** Журнал меняется по ходу связи — держим history в активной памяти, пока не вытеснит более свежее. */
  const pinMutatingDigests = (mem: DigestMemory) => {
    if (!other) return
    const rec = world.acquaintances.find((a) => a.id === other.acquaintanceId)
    if (rec && rec.history.length > 0) rememberDigest(mem, 'history')
  }
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [turns, busy, ended])

  if (!other) {
    onClose()
    return null
  }

  const lines = linesFor(world, other)
  const stance = stanceTo(world, other)
  const hireLine = lines.find((l) => l.topic === 'escort')
  const hireFee = escortFee(world, other)
  const playerName = world.player.pilotName.toUpperCase()
  const otherName = other.pilotName.toUpperCase()
  const push = (turn: ChatTurn) => setTurns((t) => [...t, turn])

  // ─ Кнопка «нанять»: домен кидает кость и меняет мир, лента показывает обмен.
  const speak = (topic: Topic) => {
    if (ended) return
    const line = lines.find((l) => l.topic === topic)
    if (!line || line.blocked) return
    rememberPilot(world, other)
    const cmd: Command = { action: 'ask', payload: { topic } }
    const fx = applyTurnToChat(push, world, other, line.say, [cmd])
    reactFace([cmd], fx)
    const emo = outcomeFace(topic, fx.askOutcome?.agreed ?? false)
    if (emo) markOutcomeEmotion(other.id, emo, world.time)
    bump()
  }

  // ─ Свободная реплика: модель ловит ТРИГГЕР и красит слова, а исход считает ДОМЕН.
  const deliverReply = (reply: NegotiatorReply) => {
    rememberPilot(world, other)
    const fx = dialogueEffects(world, other, reply.commands, reply.text)
    push({ who: 'them', text: fx.them })
    for (const line of fx.system) push({ who: 'system', text: line })
    reactFace(reply.commands, fx)
    // Собеседник сам ВЫЗВАЛ выражение лица (поле emotion): у бога — восемь ликов (divineFace),
    // у смертного — шесть (faceEmo). Строка уже провалидирована парсером по роли (`coerceEmotion`).
    //
    // Лицо ДЕРЖИТСЯ до следующей реплики, а не гаснет по таймеру в расположение. Раньше оно
    // падало обратно в baseline, и дружелюбный лыбился всегда, что бы ты ни сказал — мимика
    // не следовала за разговором и выглядела застывшей. Расположение — это лишь СТАРТ беседы;
    // дальше лицо ведёт сам разговор. Декей реакции снимаем: ответ её перебил.
    if (reply.emotion) {
      if (other.divine) setDivineFace(reply.emotion as DivineEmotion)
      else setFaceEmo(reply.emotion as Emotion)
      if (faceDecay.current !== null) {
        window.clearTimeout(faceDecay.current)
        faceDecay.current = null
      }
    }
    if (fx.askOutcome) {
      const emo = outcomeFace(fx.askOutcome.topic, fx.askOutcome.agreed)
      if (emo) markOutcomeEmotion(other.id, emo, world.time)
    }
    if (reply.hangup) {
      digestMemory.current = createDigestMemory()
      setEnded(reply.source === 'overload' ? t('dialogue.overload') : t('dialogue.hangup'))
    }
    bump()
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy || ended) return
    setInput('')
    push({ who: 'you', text })
    setBusy(true)

    const mem = digestMemory.current
    pinMutatingDigests(mem)
    const fresh = sufflerDigestsFor(text).filter((d) => !mem.active.includes(d))
    for (const digest of fresh) rememberDigest(mem, digest)

    const allowed = linesFor(world, other).filter((l) => !l.blocked).map((l) => l.topic)
    let ctx = buildContext(world, other, allowed, mem, fresh)
    let reply = await negotiate(ctx, [...turns, { who: 'you', text }], text)

    // Редкий запасной путь: модель запросила блок, который суфлёр не поймал — догружаем без паузы.
    if (reply.lookup && !reply.hangup) {
      const digest = reply.lookup
      const retryFresh = mem.active.includes(digest) ? [] : ([digest] as ContextDigest[])
      if (retryFresh.length) rememberDigest(mem, digest)
      ctx = buildContext(world, other, allowed, mem, retryFresh)
      reply = await negotiate(ctx, [...turns, { who: 'you', text }], text)
    }

    deliverReply(reply)
    pinMutatingDigests(mem)
    setBusy(false)
    // Поле было disabled на время ответа — фокус слетел. Возвращаем его, чтобы можно
    // было печатать следующую реплику не целясь мышью. Ждём снятия disabled (снимет busy).
    requestAnimationFrame(() => inputRef.current?.focus())
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
        {/* Шапка: портрет и паспорт слева; «нанять» и «положить трубку» — столбиком справа. */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <PilotPortrait ship={other} world={world} emotion={faceEmo} divineEmotion={other.divine ? divineFace ?? undefined : undefined} size={108} />
            <div className="min-w-0">
              <div className="text-lg tracking-[0.3em]">{other.pilotName.toUpperCase()}</div>
              <div className="text-xs tracking-widest" style={{ color: UI.DIM }}>
                {occupationName(other.originKind, other.faction).toUpperCase()}
              </div>
              <div className="text-xs tracking-widest" style={{ color: UI.DIM }}>
                {chassisName(other.loadout.chassis.name).toUpperCase()}
              </div>
              <div className="mt-1 text-xs tracking-widest" style={{ color: STANCE_COLOR[stance] }}>
                {t(STANCE_KEY[stance])}
              </div>
            </div>
          </div>

          {!ended && (
            <div className="flex shrink-0 flex-col items-end gap-2">
              {hireLine && (
                <Button
                  small
                  onClick={() => speak(hireLine.topic)}
                  disabled={hireLine.blocked !== null || busy}
                >
                  {hireFee != null ? t('dialogue.hire', { fee: hireFee }) : t('dialogue.hirePlain')}
                </Button>
              )}
              <Button small onClick={onClose}>
                {t('dialogue.end')}
              </Button>
              {hireLine?.blocked && (
                <span className="max-w-[11rem] text-right text-[0.65rem] leading-snug tracking-widest" style={{ color: UI.DIM }}>
                  {hireLine.blocked}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Лента разговора: и болтовня, и обмен по кнопкам ложатся сюда. */}
        <div ref={scroller} className="mb-4 min-h-[8rem] flex-1 overflow-y-auto pr-1 text-sm leading-relaxed">
          {turns.length === 0 && !busy ? (
            <span style={{ color: UI.DIM }}>{t('chat.empty')}</span>
          ) : (
            <div className="flex flex-col gap-2">
              {turns.map((t, i) => (
                <div key={i}>
                  {t.who === 'you' ? (
                    <span>
                      <span style={{ color: UI.DIM }}>{playerName}:&nbsp;</span>
                      {t.text}
                    </span>
                  ) : t.who === 'system' ? (
                    <span className="text-xs tracking-widest" style={{ color: UI.WARN }}>
                      · {t.text} ·
                    </span>
                  ) : (
                    <span>
                      <span style={{ color: UI.PRIMARY }}>{otherName}:&nbsp;</span>
                      {t.text}
                    </span>
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
              {t('dialogue.closeChannel')}
            </Button>
          </div>
        ) : (
          chatAvailable && (
            <div className="flex gap-2 border-t pt-4" style={{ borderColor: UI.DIM }}>
              <input
                ref={inputRef}
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send()
                }}
                disabled={busy}
                placeholder={t('chat.placeholder')}
                className="flex-1 border bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-50"
                style={{ borderColor: UI.DIM, color: UI.PRIMARY }}
              />
              <Button small onClick={send} disabled={busy || !input.trim()}>
                {t('chat.send')}
              </Button>
            </div>
          )
        )}
      </div>
    </div>
  )
}
