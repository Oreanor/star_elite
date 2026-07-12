import { useEffect, useState } from 'react'
import { onDisconnect, onValue, ref, remove, serverTimestamp, set } from 'firebase/database'
import { currentUserId } from './account'
import { rtdb } from './firebase'

/**
 * Присутствие: кто сейчас онлайн, в какой системе, ГДЕ в ней и пристыкован ли. Живёт в
 * Realtime Database (низкая задержка + onDisconnect: закрыл вкладку — узел стёрся сам,
 * метка исчезла у всех).
 *
 * Позицию шлём АБСОЛЮТНУЮ в системе (`state.pos + originOffset`): плавающий центр у
 * каждого свой, а сумма — общий кадр, и метки сходятся. По ней потом — точка внутри
 * системы и стрелка на цель вне видимости. Домен об этом не знает: presence целиком в
 * слое app, симуляция чиста.
 */

export interface OnlinePlayer {
  uid: string
  name: string
  /** Индекс системы — для метки на галакт-карте. */
  systemIndex: number
  /** Имя системы — готовой строкой, чтобы список не пересчитывал галактику. */
  systemName: string
  /** Пристыкован ли и где (имя станции). null — в полёте. */
  place: string | null
  /** Вид пилота — для того же портрета, что у ботов у причала. */
  species: string
  /** Выбранное лицо (индекс в листе портретов). */
  face: number
  /** Профессия — строкой рода занятий под именем. */
  profession: string
  /** Абсолютная позиция в системе (state.pos + originOffset) — для меток внутри системы. */
  x: number
  y: number
  z: number
}

/** То, что клиент публикует о себе. uid берётся из сессии, время ставит сервер. */
export type PresenceUpdate = Omit<OnlinePlayer, 'uid'>

/** Транслировать своё присутствие. onDisconnect уберёт узел, когда клиент отвалится. */
export async function publishPresence(update: PresenceUpdate): Promise<void> {
  if (!rtdb) return
  const uid = currentUserId()
  if (!uid) return
  const node = ref(rtdb, `presence/${uid}`)
  await set(node, { ...update, t: serverTimestamp() })
  void onDisconnect(node).remove()
}

/** Снять своё присутствие сейчас (выход, размонтирование) — не ждать onDisconnect. */
export async function clearPresence(): Promise<void> {
  if (!rtdb) return
  const uid = currentUserId()
  if (!uid) return
  await remove(ref(rtdb, `presence/${uid}`))
}

/** Подписка на всех онлайн, КРОМЕ себя. Возвращает отписку. */
export function subscribeOnline(cb: (players: OnlinePlayer[]) => void): () => void {
  if (!rtdb) return () => {}
  const me = currentUserId()
  return onValue(ref(rtdb, 'presence'), (snap) => {
    const val = (snap.val() ?? {}) as Record<string, Partial<OnlinePlayer>>
    const list: OnlinePlayer[] = []
    for (const [uid, p] of Object.entries(val)) {
      if (uid === me || typeof p?.systemIndex !== 'number') continue
      list.push({
        uid,
        name: p.name ?? '???',
        systemIndex: p.systemIndex,
        systemName: p.systemName ?? '—',
        place: p.place ?? null,
        species: p.species ?? 'human',
        face: p.face ?? 0,
        profession: p.profession ?? 'traveler',
        x: p.x ?? 0,
        y: p.y ?? 0,
        z: p.z ?? 0,
      })
    }
    cb(list)
  })
}

/** Реактивный список онлайн-игроков (кроме себя) для интерфейса. Пусто в офлайне. */
export function useOnlinePlayers(): OnlinePlayer[] {
  const [players, setPlayers] = useState<OnlinePlayer[]>([])
  useEffect(() => subscribeOnline(setPlayers), [])
  return players
}
