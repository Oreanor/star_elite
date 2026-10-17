import type { ShipEntity, World } from '../world/entities'
import { applyCommand, type Command } from './commandBus'
import type { Topic } from './dialogue'
import { joinPhrases, phrase, type Phrase } from './phrase'
import type { Reaction } from './temper'

/** Что показать в ленте после исполнения команд (кнопка или LLM — один контур). */
export interface DialogueEffects {
  /**
   * Реплика собеседника: слова модели (строка, уже на языке игрока) или фраза домена —
   * отказ/подтверждение, которые домен произносит сам (слова подберёт `ui`).
   */
  them: string | Phrase
  /** Системные подтверждения (сделка, приказ…). */
  system: Phrase[]
  /** Исход просьбы-действия — для эмоции на портрете. */
  askOutcome: { topic: Topic; agreed: boolean } | null
  /** Реакция на речевой акт игрока, если он был (`temper.ts`). */
  reaction: Reaction | null
  /** Домен оборвал разговор: собеседник ушёл или стал врагом (`CommandOutcome.ends`). */
  ends: boolean
}

/**
 * Исполнить команды боту и собрать, что рисовать в ленте.
 * `replyText` — слова модели; при отказе по `ask` доменная `spoken` важнее.
 */
export function dialogueEffects(
  world: World,
  ship: ShipEntity,
  commands: Command[],
  replyText: string,
): DialogueEffects {
  const outcomes = commands.map((cmd) => ({ cmd, out: applyCommand(world, ship, cmd) }))
  const askEntry = outcomes.find((o) => o.cmd.action === 'ask') ?? null
  const refused = askEntry?.out?.agreed === false
  const spoken = outcomes.map((o) => o.out?.spoken).filter((p): p is Phrase => !!p)
  // Дело, на которое модель «согласилась», а домен отказал (трюм мал, дела нет): звучит отказ
  // домена, иначе бот выглядел бы вруном — «по рукам!», а дела нет.
  const jobRefusal = outcomes.find((o) => (o.cmd.action === 'job' || o.cmd.action === 'gift') && o.out?.agreed === false && o.out.spoken)?.out?.spoken
  const them: string | Phrase = refused
    ? (askEntry!.out!.spoken ?? (replyText || (spoken[0] ?? phrase('ellipsis'))))
    : (jobRefusal ?? (replyText || joinPhrases(spoken) || phrase('ellipsis')))
  const system = outcomes.map((o) => o.out?.line).filter((p): p is Phrase => !!p)

  let askOutcome: DialogueEffects['askOutcome'] = null
  if (askEntry?.out && askEntry.cmd.action === 'ask') {
    const topic = (askEntry.cmd.payload as { topic: Topic }).topic
    askOutcome = { topic, agreed: askEntry.out.agreed ?? false }
  }

  const ends = outcomes.some((o) => o.out?.ends === true)
  const reaction = outcomes.find((o) => o.out?.reaction)?.out?.reaction ?? null
  return { them, system, askOutcome, ends, reaction }
}
