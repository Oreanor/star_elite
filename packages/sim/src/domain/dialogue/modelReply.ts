import { buildCommands, type DialogueRole } from './actions'
import type { Command } from './commandBus'
import type { Topic } from './dialogue'
import { coerceClarify, coerceLookup, type LookupDigest } from './payload'

/**
 * Восемь выражений лица бога Слова (лист `dude.jpg`) и шесть — обычного пилота (портреты видов).
 * Строки, а не UI-тип: домен красок не знает, он лишь ПРОВЕРЯЕТ, что модель назвала допустимое
 * для роли, а рисует UI. Набор зависит от роли: у бога свой лист эмоций, у смертного — свой.
 */
export const DIVINE_EMOTIONS = [
  'neutral', 'smile', 'laugh', 'tired', 'confusion', 'surprise', 'frown', 'angry',
] as const
export const BOT_EMOTIONS = ['neutral', 'joy', 'pain', 'anger', 'fear', 'sadness'] as const

const DIVINE_EMOTION_SET: ReadonlySet<string> = new Set(DIVINE_EMOTIONS)
const BOT_EMOTION_SET: ReadonlySet<string> = new Set(BOT_EMOTIONS)

/** Ответ модели после разбора JSON — без метаданных сети (source, overload). */
export interface ParsedModelReply {
  text: string
  commands: Command[]
  hangup: boolean
  lookup: LookupDigest | null
  /** Поручение непонятно через переводчик — только переспрос, без команд. */
  clarify?: boolean
  /** Выражение лица, которое модель ВЫЗВАЛА этой репликой. null — не задано. */
  emotion?: string | null
}

/** Проверить выражение лица против набора роли: у бога 8 эмоций, у смертного — 6. */
function coerceEmotion(v: unknown, role: DialogueRole): string | null {
  if (typeof v !== 'string') return null
  const set = role === 'god' ? DIVINE_EMOTION_SET : BOT_EMOTION_SET
  return set.has(v) ? v : null
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
 * Плоский JSON модели → реплика с командами. Команды собирает ПУЛ экшнов по НАБОРУ РОЛИ
 * (`buildCommands`), а не лестница `if`: какие способности у роли — сказано в `actions.ts`.
 * Envelope реплики (текст, эмоция, hangup, lookup, clarify) — общий для всех ролей и живёт здесь.
 */
export function parseModelReply(
  parsed: unknown,
  allowedTopics: readonly Topic[],
  role: DialogueRole = 'bot',
  /** Гонорар найма, если обсуждается: по нему отличают эхо платы от осознанного платежа. */
  escortFee: number | null = null,
): ParsedModelReply | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  const text = typeof o.reply === 'string' ? o.reply.trim() : ''
  if (!text) return null

  const emotion = coerceEmotion(o.emotion, role)
  const lookup = coerceLookup(o.lookup)

  // Переводчик не понял поручение — только переспрос, никаких команд не собираем.
  if (coerceClarify(o.clarify)) {
    return { text, commands: [], hangup: false, lookup, clarify: true, emotion }
  }

  const commands = buildCommands(o, role, { allowedTopics, escortFee })
  return { text, commands, hangup: o.hangup === true, lookup, emotion }
}
