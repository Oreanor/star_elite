import { useEffect, useRef, useState } from 'react'
import { Button, PilotPortrait } from '../station/chrome'
import { UI } from '../theme'
import { t, useLang } from '../i18n'
import { professionName } from '../i18n/dataNames'
import { currentUserId } from '../../app/net/account'
import { sendChat, useChat } from '../../app/net/chat'
import type { OnlinePlayer } from '../../app/net/presence'

/**
 * Окно чата с живым игроком — то же, что разговор с ботом, но БЕЗ модели и БЕЗ механик:
 * ни кнопок «сдаться/нанять/ограбить», ни распознавания — их судит домен, а тут напротив
 * не бот, а человек. Просто текст: обе стороны пишут в общий узел RTDB, лента у обоих.
 *
 * Окно рисуется поверх консоли (открыто с плашки во вкладке ЛЮДИ). Мир под ним живёт
 * своим чередом — паузы нет: у сети чужой корабль не остановить, да и незачем.
 */
export function PlayerChat({ player, onClose }: { player: OnlinePlayer; onClose: () => void }) {
  useLang()
  const me = currentUserId()
  const messages = useChat(player.uid)
  const [input, setInput] = useState('')

  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages])

  const send = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    void sendChat(player.uid, text)
  }

  const where = player.place
    ? t('people.online.dock', { place: player.place, sys: player.systemName })
    : t('people.online.sys', { sys: player.systemName })

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80 font-mono" style={{ color: UI.PRIMARY }}>
      {/* Тот же корпус, что у окна разговора: фиксированная высота, лента забирает остаток. */}
      <div className="flex h-[38rem] max-h-[85vh] w-[40rem] flex-col border px-8 py-6" style={{ borderColor: UI.PRIMARY }}>
        {/* Портрет из вида+лица (пришли в presence), имя, род занятий и где он сейчас. */}
        <div className="mb-4 flex items-center gap-4">
          <PilotPortrait species={player.species} face={player.face} size={108} />
          <div className="min-w-0">
            <div className="text-lg tracking-[0.3em]">{player.name.toUpperCase()}</div>
            <div className="text-xs tracking-widest" style={{ color: UI.DIM }}>
              {professionName(player.profession).toUpperCase()} · {t('chat.online')} · {where}
            </div>
          </div>
        </div>

        {/* Лента: свои реплики с меткой «ТЫ», чужие — тире, как в разговоре с ботом. */}
        <div ref={scroller} className="mb-4 min-h-[8rem] flex-1 overflow-y-auto pr-1 text-sm leading-relaxed">
          {messages.length === 0 ? (
            <span style={{ color: UI.DIM }}>{t('chat.empty')}</span>
          ) : (
            <div className="flex flex-col gap-2">
              {messages.map((m, i) => (
                <div key={i}>
                  {m.from === me ? (
                    <span>
                      <span style={{ color: UI.DIM }}>{t('chat.you')}:&nbsp;</span>
                      {m.text}
                    </span>
                  ) : (
                    <span style={{ color: UI.PRIMARY }}>— {m.text}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mb-3 flex gap-2">
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
            placeholder={t('chat.placeholder')}
            className="flex-1 border bg-transparent px-3 py-2 text-sm outline-none"
            style={{ borderColor: UI.DIM, color: UI.PRIMARY }}
          />
          <Button small onClick={send} disabled={!input.trim()}>
            {t('chat.send')}
          </Button>
        </div>

        <div className="mt-1 text-center text-xs tracking-widest" style={{ color: UI.DIM }}>
          <button type="button" className="cursor-pointer hover:underline" onClick={onClose}>
            {t('chat.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
