import type { ChatTurn } from '../../ui/dialogue/facts'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Реплики канала → сообщения модели. Исходы из канала (строки `system`: «Зачислено: 100 кр») —
 * ФАКТЫ разговора. Прежде их выбрасывали, и модель видела только слова: сказала «принял» без
 * перевода — и не узнала, что ничего не пришло; перевод прошёл — и через пару реплик «нет
 * записи». Факт идёт после реплики бота, поэтому кладём его в начало СЛЕДУЮЩЕЙ реплики
 * командира (или в `finalUser`): роли чередуются, порядок событий цел.
 *
 * @param factTag Пометка факта на языке разговора («ФАКТ КАНАЛА»).
 * @param finalUser Текущая реплика командира — последняя в запросе.
 */
export function chatMessages(turns: readonly ChatTurn[], finalUser: string, factTag: string): ChatMessage[] {
  const out: ChatMessage[] = []
  let facts: string[] = []
  const withFacts = (text: string) => {
    const tagged = facts.length ? `${facts.map((f) => `[${factTag}: ${f}]`).join('\n')}\n${text}` : text
    facts = []
    return tagged
  }
  for (const turn of turns) {
    if (turn.who === 'system') facts.push(turn.text)
    else if (turn.who === 'you') out.push({ role: 'user', content: withFacts(turn.text) })
    else out.push({ role: 'assistant', content: turn.text })
  }
  out.push({ role: 'user', content: withFacts(finalUser) })
  return out
}
