import { useEffect, useState } from 'react'
import { limitToLast, onChildAdded, onValue, push, query, ref, remove, serverTimestamp, set } from 'firebase/database'
import { currentUserId } from './account'
import { rtdb } from './firebase'
import type { OnlinePlayer, PresenceUpdate } from './presence'

/**
 * Чат между двумя живыми игроками. Это НЕ разговор с ботом лишь содержимым: ни модели,
 * ни механик (сдаться/нанять/ограбить — про домен и ИИ), просто текст. Всё прочее —
 * как с ботом: окно то же, мир под ним на паузе, канал закрывают на T.
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

/**
 * Отправить строку собеседнику. Кроме самого сообщения кладём «пинг» в его инбокс со
 * своей карточкой (имя, вид, лицо, где я) — по нему у собеседника всплывёт окно, как
 * входящий вызов, даже если меня нет в его списке В СЕТИ (мы в разных системах).
 */
export async function sendChat(peerUid: string, text: string, self: PresenceUpdate): Promise<void> {
  const body = text.trim()
  if (!rtdb || !body) return
  const me = currentUserId()
  if (!me) return
  const database = rtdb
  await push(ref(database, `chats/${channelId(me, peerUid)}/messages`), { from: me, text: body, t: serverTimestamp() })
  await set(ref(database, `inbox/${peerUid}/${me}`), {
    name: self.name,
    species: self.species,
    face: self.face,
    profession: self.profession,
    systemIndex: self.systemIndex,
    systemName: self.systemName,
    place: self.place,
    t: serverTimestamp(),
  })
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

/**
 * Входящие вызовы: подписка на свой инбокс. На каждый пинг зовём `cb` с карточкой
 * звонящего (как `OnlinePlayer`, чтобы открыть тем же окном). Пинг СРАЗУ стираем —
 * иначе он всплывал бы снова при каждом перезаходе; новое сообщение положит его вновь.
 */
export function subscribeInbox(cb: (caller: OnlinePlayer) => void): () => void {
  if (!rtdb) return () => {}
  const me = currentUserId()
  if (!me) return () => {}
  const database = rtdb
  return onChildAdded(ref(database, `inbox/${me}`), (snap) => {
    const from = snap.key
    const c = snap.val() as Partial<OnlinePlayer> | null
    if (!from || !c) return
    cb({
      uid: from,
      name: c.name ?? '???',
      systemIndex: typeof c.systemIndex === 'number' ? c.systemIndex : -1,
      systemName: c.systemName ?? '—',
      place: c.place ?? null,
      // Звонящий пишет из разговора — он «отошёл»; но в окне чата это не гасим (см. PlayerChat).
      paused: c.paused ?? true,
      species: c.species ?? 'human',
      face: c.face ?? 0,
      profession: c.profession ?? 'traveler',
      x: 0,
      y: 0,
      z: 0,
    })
    void remove(ref(database, `inbox/${me}/${from}`))
  })
}
