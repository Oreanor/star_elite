import type { PlayerSave } from '@elite/sim'
import { online } from '../net/firebase'
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
    void writeServerSave(save)
      .then(() => setSaveFailed(false))
      .catch((e) => {
        console.warn('Серверный сейв не удался:', e)
        setSaveFailed(true)
      })
  } else {
    writeSave(save)
  }
}

/**
 * Исход последней записи сейва. Прежде сбой уходил лишь в консоль браузера — игрок узнавал
 * о нём после рефреша, по откатившимся деньгам. Сейв пишется у причала, поэтому и сигнал
 * показывает экран станции (`useSaveFailed`), а не плашка полёта.
 */
let saveFailed = false
const saveListeners = new Set<() => void>()

function setSaveFailed(value: boolean): void {
  if (saveFailed === value) return
  saveFailed = value
  for (const l of saveListeners) l()
}

export function subscribeSaveStatus(listener: () => void): () => void {
  saveListeners.add(listener)
  return () => saveListeners.delete(listener)
}

export function lastSaveFailed(): boolean {
  return saveFailed
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
    setSaveFailed(false)
  } catch {
    // Недоступно/полно — игру не роняем, но игрок должен знать: прогресс не записан.
    setSaveFailed(true)
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
