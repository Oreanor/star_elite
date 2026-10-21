import { useEffect, useRef, useState } from 'react'
import { PilotPortrait } from '../station/chrome'
import { PilotIdentity } from '../station/PilotIdentity'
import { DialogueWindow, SayBar, Transcript } from '../dialogue/DialogueShell'
import { UI } from '../theme'
import { t, useLang } from '../i18n'
import { properName, professionName } from '../i18n/dataNames'
import { useSession } from '../../session/GameContext'
import { currentUserId } from '../../session/net/account'
import { sendChat, useChat } from '../../session/net/chat'
import { selfPresence, type OnlinePlayer } from '../../session/net/presence'

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
  const session = useSession()
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
    // Со своей карточкой: у собеседника всплывёт окно (входящий), и он увидит, кто пишет.
    // Пишешь из разговора — значит отошёл (paused): в карточке так и помечаем.
    void sendChat(player.uid, text, selfPresence(session.world, true))
  }

  // Имена приходят по сети КАНОНОМ домена — переводит их тот, кто показывает.
  const where = player.place
    ? t('people.online.dock', { place: properName(player.place), sys: properName(player.systemName) })
    : t('people.online.sys', { sys: properName(player.systemName) })

  // Тот же корпус, что у разговора с ботом (`DialogueWindow`): чат с человеком — не другое
  // приложение. Прежде у него была своя квадратная рамка, «ТЫ:»/тире и ссылка вместо кнопки.
  const turns = messages.map((m) => ({ who: m.from === me ? 'you' : 'them', text: m.text }))
  return (
    <DialogueWindow
      world={session.world}
      onClose={onClose}
      identity={
        // Портрет из вида+лица (пришли в presence), имя, род занятий и где он сейчас.
        <PilotIdentity
          portrait={<PilotPortrait species={player.species} face={player.face} size={108} />}
          name={player.name}
          role={`${professionName(player.profession)} · ${t('chat.online')}`}
        >
          <div className="text-xs tracking-widest" style={{ color: UI.DIM }}>
            {where}
          </div>
        </PilotIdentity>
      }
    >
      <Transcript scroller={scroller} turns={turns} myName={session.world.player.pilotName} theirName={player.name} />
      <SayBar value={input} onChange={setInput} onSend={send} />
    </DialogueWindow>
  )
}

/**
 * Баннер «второй входящий»: живой игрок зовёт, пока ты занят другим разговором. Не
 * перебивает — висит сверху, пока не положишь трубку текущего. По одному за раз, чтобы
 * было понятно, какой разговор закрывает T.
 */
export function IncomingCall({ caller }: { caller: OnlinePlayer }) {
  useLang()
  return (
    <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center font-mono">
      <div
        className="flex items-center gap-3 border px-4 py-2"
        style={{ borderColor: UI.WARN, background: 'rgba(4,12,22,0.92)' }}
      >
        <PilotPortrait species={caller.species} face={caller.face} size={44} />
        <div className="min-w-0">
          <div className="text-xs tracking-[0.3em]" style={{ color: UI.WARN }}>
            {t('chat.incoming')} · {caller.name.toUpperCase()}
          </div>
          <div className="text-[0.65rem] tracking-widest" style={{ color: UI.DIM }}>
            {t('chat.incoming.hint')}
          </div>
        </div>
      </div>
    </div>
  )
}
