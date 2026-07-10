import { useState } from 'react'
import { interlocutor, linesFor, say, type Reply, type Topic } from '@elite/sim'
import { useSession } from '../../app/GameContext'
import { Button } from '../station/chrome'
import { UI } from '../theme'

/**
 * Разговор с захваченным кораблём.
 *
 * Ни одного правила здесь нет. Что можно сказать, кому и чем это кончится, решает
 * домен (`linesFor`, `say`); окно только показывает список и присылает выбор.
 * Поэтому переговоры проверяются тестами без браузера — и однажды заработают
 * на сервере тем же кодом.
 *
 * Мир под окном СТОИТ: оно отпускает курсор, а пауза в этой игре и есть отпущенный
 * курсор. Второго флага паузы не заводим.
 */
export function Dialogue({ onClose }: { onClose: () => void }) {
  const session = useSession()
  const world = session.world
  const other = interlocutor(world)

  /** Последний ответ. Реплика сказана один раз — ответ помнит окно, а не мир. */
  const [reply, setReply] = useState<Reply | null>(null)

  if (!other) {
    onClose()
    return null
  }

  const lines = linesFor(world, other)

  const speak = (topic: Topic) => {
    setReply(say(world, other, topic))
  }

  const hostile = other.faction === 'hostile'

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black/80 font-mono"
      style={{ color: UI.PRIMARY }}
    >
      <div className="w-[34rem] border px-8 py-6" style={{ borderColor: UI.PRIMARY }}>
        <div className="mb-1 text-lg tracking-[0.3em]">{other.name.toUpperCase()}</div>
        <div className="mb-6 text-xs tracking-widest" style={{ color: UI.DIM }}>
          {hostile ? 'ВРАЖДЕБНЫЙ' : 'МИРНЫЙ'} · {Math.round(other.state.pos.distanceTo(world.player.state.pos))} М
        </div>

        {/* Ответ занимает место всегда: иначе кнопки прыгают после первой реплики. */}
        <div className="mb-6 min-h-[3.5rem] text-sm leading-relaxed">
          {reply ? (
            <span style={{ color: reply.agreed ? UI.PRIMARY : UI.WARN }}>— {reply.text}</span>
          ) : (
            <span style={{ color: UI.DIM }}>Канал открыт. Он слушает.</span>
          )}
        </div>

        <div className="flex flex-col items-stretch gap-2">
          {lines.map((line) => (
            <div key={line.topic} className="flex flex-col">
              <Button small onClick={() => speak(line.topic)} disabled={line.blocked !== null}>
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

        <div className="mt-6 text-center text-xs tracking-widest" style={{ color: UI.DIM }}>
          <button type="button" className="cursor-pointer hover:underline" onClick={onClose}>
            T — ЗАКРЫТЬ КАНАЛ
          </button>
        </div>
      </div>
    </div>
  )
}
