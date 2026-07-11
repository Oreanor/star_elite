import type { PlayerSave } from '@elite/sim'
import { online } from '../net/supabase'
import { writeServerSave } from '../net/account'

/**
 * Хранилище сейва игрока. ОНЛАЙН (настроен Supabase) — источник правды сервер, сюда
 * автосейв идёт через `writeServerSave`. ОФЛАЙН (ключей нет) — кэш в localStorage,
 * чтобы игра и master-ветка работали без сети. Ветвится в `persistSave` по `online`.
 *
 * Здесь только чтение/запись строки — вся правда о том, ЧТО сохранять, живёт в
 * доменном `serializePlayer`/`applyPlayerSave`. Отказ хранилища (приватный режим,
 * переполнение, обрыв сети) не роняет игру: сейв не критичен для текущей секунды.
 */

const KEY = 'elite.save'

/**
 * Записать сейв туда, где источник правды: онлайн — на сервер (по стыковке, fire-and-
 * forget: автосейв не должен вешать кадр), офлайн — в localStorage. Один вызов на месте
 * стыковки не знает про режим — знает он.
 */
export function persistSave(save: PlayerSave): void {
  if (online) {
    void writeServerSave(save).catch((e) => console.warn('Серверный сейв не удался:', e))
  } else {
    writeSave(save)
  }
}

/** Прочитать сейв. Пусто/битое/чужой версии — как будто сейва нет, а не падение. */
export function loadSave(): PlayerSave | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const save = JSON.parse(raw) as PlayerSave
    // Версию проверяем: старый/чужой формат честнее счесть «нет сейва», чем упасть.
    return save && save.version === 1 ? save : null
  } catch {
    return null
  }
}

export function writeSave(save: PlayerSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save))
  } catch {
    // Недоступно/полно — переживём: сохранение не обязано удаться сию секунду.
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
