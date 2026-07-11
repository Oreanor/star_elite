import type { PlayerSave } from '@elite/sim'

/**
 * Кэш сейва игрока в localStorage. ФАЗА 0: локально; Фаза 3 переедет на сервер
 * (Supabase — источник правды), а localStorage останется быстрым кэшем для старта.
 *
 * Здесь только чтение/запись строки — вся правда о том, ЧТО сохранять, живёт в
 * доменном `serializePlayer`/`applyPlayerSave`. Отказ хранилища (приватный режим,
 * переполнение) не роняет игру: сейв не критичен для текущей сессии.
 */

const KEY = 'elite.save'

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
