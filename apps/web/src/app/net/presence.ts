import { useEffect, useState } from 'react'
import { onDisconnect, onValue, ref, remove, serverTimestamp, set } from 'firebase/database'
import type { World } from '@elite/sim'
import { currentUserId } from './account'
import { rtdb } from './firebase'
import { properName } from '../../ui/i18n/dataNames'

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
  /**
   * «Отошёл»: мир у него на паузе (открыл меню/разговор) — значит в игре его нет, аватар
   * гаснет, а корабль (когда появится сетевой рендер бортов) из чужого мира исчезает.
   * НЕ ставится при врагах рядом: иначе паузой можно было бы исчезать из боя — это чит.
   */
  paused: boolean
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

/**
 * Собрать своё присутствие из мира: имя, система, место у причала, вид/лицо/профессия
 * (для портрета у других) и АБСОЛЮТНАЯ позиция. Один источник и для публикации метки,
 * и для карточки в чате — чтобы собеседник видел тебя так же, как в списке В СЕТИ.
 */
export function selfPresence(world: World, paused: boolean): PresenceUpdate {
  const station = world.docked ? world.bodies.find((b) => b.kind === 'station') : undefined
  const pos = world.player.state.pos
  const off = world.originOffset
  return {
    name: world.player.pilotName,
    systemIndex: world.systemIndex,
    systemName: properName(world.systemName),
    place: station ? properName(station.name) : null,
    paused,
    species: world.player.persona.species,
    face: world.player.persona.portrait ?? 0,
    profession: world.player.persona.profession ?? 'traveler',
    x: pos.x + off.x,
    y: pos.y + off.y,
    z: pos.z + off.z,
  }
}

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
        paused: p.paused ?? false,
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
