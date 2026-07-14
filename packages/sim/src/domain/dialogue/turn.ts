import type { ShipEntity, World } from '../world/entities'
import { applyCommand, type Command } from './commandBus'
import type { Topic } from './dialogue'

/** Что показать в ленте после исполнения команд (кнопка или LLM — один контур). */
export interface DialogueEffects {
  /** Реплика собеседника. */
  them: string
  /** Системные подтверждения (сделка, приказ…). */
  system: string[]
  /** Исход просьбы-действия — для эмоции на портрете. */
  askOutcome: { topic: Topic; agreed: boolean } | null
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
  const spoken = outcomes.map((o) => o.out?.spoken).filter((line): line is string => !!line)
  const them = refused
    ? (askEntry!.out!.spoken ?? (replyText || (spoken[0] ?? '…')))
    : (replyText || spoken.join(' ') || '…')
  const system = outcomes.map((o) => o.out?.line).filter((line): line is string => !!line)

  let askOutcome: DialogueEffects['askOutcome'] = null
  if (askEntry?.out && askEntry.cmd.action === 'ask') {
    const topic = (askEntry.cmd.payload as { topic: Topic }).topic
    askOutcome = { topic, agreed: askEntry.out.agreed ?? false }
  }

  return { them, system, askOutcome }
}
