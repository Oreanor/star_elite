import { useEffect, useState } from 'react'
import { onDisconnect, onValue, ref, remove, serverTimestamp, set } from 'firebase/database'
import type { World } from '@elite/sim'
import { currentUserId } from './account'
import { rtdb, serverNow } from './firebase'
import { deadStamp, reapDead } from './reap'
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

/**
 * Насколько давняя отметка ещё считается «в сети», мс. Публикуем раз в 2 с, так что живой
 * подтверждает себя тридцать раз за этот срок.
 *
 * Порог щедрый нарочно: фоновая вкладка душит таймеры до раза в минуту, и отошедший на кухню
 * не должен пропадать из списка. Вычеркнуть живого не страшно — вернётся со следующим пакетом;
 * но и мертвец теперь висит здесь минуту, а не вечно.
 */
const STALE_MS = 90_000

/** Подписка на всех онлайн, КРОМЕ себя. Возвращает отписку. */
export function subscribeOnline(cb: (players: OnlinePlayer[]) => void): () => void {
  if (!rtdb) return () => {}
  const me = currentUserId()
  return onValue(ref(rtdb, 'presence'), (snap) => {
    const val = (snap.val() ?? {}) as Record<string, Partial<OnlinePlayer> & { t?: number }>
    const list: OnlinePlayer[] = []
    const now = serverNow()
    for (const [uid, p] of Object.entries(val)) {
      if (uid === me || typeof p?.systemIndex !== 'number') continue
      /**
       * ПРОВЕРКА ЖИЗНИ, которой здесь не было вовсе: отметку `t` честно писали при каждой
       * публикации — и ни разу не читали. Всё держалось на `onDisconnect`, а он лишь БЫСТРЫЙ
       * путь, не гарантия: не заметил сервер обрыва — узел остался, и вышедший из игры висел
       * в списке вечно, потому что стереть его было уже некому.
       */
      if (typeof p.t !== 'number' || now - p.t > STALE_MS) {
        // Совсем древних попутно выносим из базы. Свежепротухших не трогаем: вдруг вкладка
        // просто задремала — вернётся, и отметка оживёт сама.
        if (deadStamp(p.t)) reapDead(`presence/${uid}`)
        continue
      }
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
