import type { ReactNode, RefObject } from 'react'
import type { World } from '@elite/sim'
import { Button } from '../station/chrome'
import { GLASS_PANEL, screenBackground } from '../station/backdrop'
import { UI } from '../theme'
import { t } from '../i18n'

/**
 * ОКНО РАЗГОВОРА — одно на все: бот, диспетчер, второй пилот, живой игрок. Фон консоли (у
 * причала — снимок станции, в полёте — стекло с блюром), «стекло» панели, шапка: паспорт
 * слева, действия столбиком справа и всегда «положить трубку». Прежде каждое окно несло свою
 * копию вёрстки, а чат с игроком и вовсе свою — квадратную рамку и ссылку вместо кнопки.
 *
 * Высота окна ФИКСИРОВАНА: лента (`flex-1`) забирает остаток и скроллится внутри, окно не
 * прыгает по мере набегания реплик.
 */
export function DialogueWindow({
  world,
  identity,
  actions,
  onClose,
  hangUp = true,
  children,
}: {
  world: World
  /** Паспорт собеседника (`PilotIdentity`). */
  identity: ReactNode
  /** Действия над «положить трубку»: нанять, дела… */
  actions?: ReactNode
  onClose: () => void
  /** Канал оборван — «положить трубку» внизу панелью обрыва, а не в шапке. */
  hangUp?: boolean
  children: ReactNode
}) {
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
          {identity}
          <div className="flex shrink-0 flex-col items-end gap-2">
            {actions}
            {hangUp && (
              <Button small onClick={onClose}>
                {t('dialogue.end')}
              </Button>
            )}
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Реплика ленты. `you` — ты, `system` — служебная строка, прочее — собеседник. */
export interface TranscriptTurn {
  who: string
  text: string
}

/** Лента «Имя: реплика». Одна вёрстка — одни и те же цвета имён и служебных строк. */
export function Transcript({
  scroller,
  turns,
  myName,
  theirName,
  busy = false,
}: {
  scroller: RefObject<HTMLDivElement | null>
  turns: readonly TranscriptTurn[]
  myName: string
  theirName: string
  busy?: boolean
}) {
  return (
    <div ref={scroller} className="mb-4 min-h-[8rem] flex-1 overflow-y-auto pr-1 text-sm leading-relaxed">
      {turns.length === 0 && !busy ? (
        <span style={{ color: UI.DIM }}>{t('chat.empty')}</span>
      ) : (
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
      )}
    </div>
  )
}

/** Строка ввода под чертой: поле и «СКАЗАТЬ». Enter — то же, что кнопка. */
export function SayBar({
  inputRef,
  value,
  onChange,
  onSend,
  busy = false,
}: {
  inputRef?: RefObject<HTMLInputElement | null>
  value: string
  onChange: (v: string) => void
  onSend: () => void
  busy?: boolean
}) {
  return (
    <div className="flex gap-2 border-t pt-4" style={{ borderColor: UI.DIM }}>
      <input
        ref={inputRef}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSend()
        }}
        disabled={busy}
        placeholder={t('chat.placeholder')}
        className="flex-1 border bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-50"
        style={{ borderColor: UI.DIM, color: UI.PRIMARY }}
      />
      <Button small onClick={onSend} disabled={busy || !value.trim()}>
        {t('chat.send')}
      </Button>
    </div>
  )
}
