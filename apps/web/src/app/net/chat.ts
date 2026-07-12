import { useEffect, useState } from 'react'
import { limitToLast, onValue, push, query, ref, serverTimestamp } from 'firebase/database'
import { currentUserId } from './account'
import { rtdb } from './firebase'

/**
 * Чат между двумя живыми игроками. Это НЕ разговор с ботом: ни модели, ни механик
 * (сдаться/нанять/ограбить — про домен и ИИ). Просто текст в общий узел, оба подписаны.
 *
 * Канал пары — детерминированный ключ из двух uid по возрастанию: у обоих один и тот
 * же `chats/{cid}`, кто бы ни написал первым. Живёт в Realtime Database рядом с
 * присутствием; правила пускают в узел только тех двоих, чьи uid в его имени.
 */

export interface ChatMessage {
  /** uid автора — сравнивая со своим, различаем «ты» и «он». */
  from: string
  text: string
}

/** Ключ канала пары: два uid по возрастанию через разделитель. Симметричен. */
function channelId(a: string, b: string): string {
  return [a, b].sort().join('__')
}

/** Отправить строку собеседнику. Пусто/офлайн/без входа — молча ничего. */
export async function sendChat(otherUid: string, text: string): Promise<void> {
  const body = text.trim()
  if (!rtdb || !body) return
  const me = currentUserId()
  if (!me) return
  const node = ref(rtdb, `chats/${channelId(me, otherUid)}/messages`)
  await push(node, { from: me, text: body, t: serverTimestamp() })
}

/**
 * Подписка на ленту канала с собеседником. Отдаёт последние сообщения по порядку
 * (ключи push хронологические). Возвращает отписку. Офлайн — пустая лента.
 */
export function subscribeChat(otherUid: string, cb: (messages: ChatMessage[]) => void): () => void {
  if (!rtdb) return () => {}
  const me = currentUserId()
  if (!me) return () => {}
  const q = query(ref(rtdb, `chats/${channelId(me, otherUid)}/messages`), limitToLast(200))
  return onValue(q, (snap) => {
    const val = (snap.val() ?? {}) as Record<string, { from?: string; text?: string }>
    // Object.entries идёт в порядке ключей вставки — а push-ключи уже хронологические.
    const list: ChatMessage[] = []
    for (const [, m] of Object.entries(val)) {
      if (typeof m?.text === 'string' && typeof m?.from === 'string') list.push({ from: m.from, text: m.text })
    }
    cb(list)
  })
}

/** Реактивная лента чата с собеседником для окна. */
export function useChat(otherUid: string): ChatMessage[] {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  useEffect(() => subscribeChat(otherUid, setMessages), [otherUid])
  return messages
}
