import type { Command } from './commandBus'
import type { Topic } from './dialogue'
import {
  coerceLookup,
  coerceOrder,
  coercePlanSteps,
  coerceClarify,
  coerceLearn,
  coerceTopic,
  coerceTransfer,
  sanitizeEscortTransfer,
  type LookupDigest,
} from './payload'

/** Ответ модели после разбора JSON — без метаданных сети (source, overload). */
export interface ParsedModelReply {
  text: string
  commands: Command[]
  hangup: boolean
  lookup: LookupDigest | null
  /** Поручение непонятно через переводчик — только переспрос, без команд. */
  clarify?: boolean
}

/** Вытащить JSON из ответа модели, даже если она обернула его в текст или ```. */
export function extractModelJson(raw: string): unknown {
  const fenced = raw.replace(/```json/gi, '').replace(/```/g, '')
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(fenced.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Плоские поля JSON модели → команды шины. Whitelist'ы — в `payload.ts`;
 * исход и отношение считает домен при `applyCommand`.
 */
export function parseModelReply(parsed: unknown, allowedTopics: readonly Topic[]): ParsedModelReply | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  const text = typeof o.reply === 'string' ? o.reply.trim() : ''
  if (!text) return null

  const clarify = coerceClarify(o.clarify)
  const commands: Command[] = []

  if (clarify) {
    return { text, commands, hangup: false, lookup: coerceLookup(o.lookup), clarify: true }
  }

  const intent = coerceTopic(o.intent)
  if (intent && allowedTopics.includes(intent)) {
    commands.push({ action: 'ask', payload: { topic: intent, llm: true } })
  }

  if (o.social === 'insult' || o.social === 'flatter') {
    commands.push({ action: 'social', payload: { tone: o.social } })
  }

  const order = coerceOrder(o.command)
  if (order) {
    const target = typeof o.commandTarget === 'number' ? o.commandTarget : null
    commands.push({ action: 'order', payload: { order, target } })
  }

  const transfer = sanitizeEscortTransfer(coerceTransfer(o.transfer), intent)
  if (transfer) commands.push({ action: 'transfer', payload: transfer })

  const remember = typeof o.remember === 'string' && o.remember.trim() ? o.remember.trim() : null
  if (remember) commands.push({ action: 'note', payload: { text: remember } })

  const learn = coerceLearn(o.learn)
  if (learn) commands.push({ action: 'learn', payload: { text: learn } })

  const planSteps = coercePlanSteps(o.plan)
  if (planSteps.length > 0) commands.push({ action: 'plan', payload: { steps: planSteps } })

  return {
    text,
    commands,
    hangup: o.hangup === true,
    lookup: coerceLookup(o.lookup),
  }
}
