import { EN } from './en'
import { RU } from './ru'

/**
 * Язык интерфейса.
 *
 * Живёт в обычной переменной модуля, а не в состоянии React, и это не лень.
 * HUD рисуется императивно в кадре, на канвасе, без единого компонента: спросить
 * контекст ему неоткуда. Язык — то же, что палитра: настройка процесса, а не
 * данные дерева. React о смене узнаёт подпиской и перерисовывает меню; кадр
 * узнаёт тем, что в следующий раз прочтёт новое значение.
 *
 * Домен языка НЕ ЗНАЕТ и знать не должен. Он возвращает идентификаторы реплик
 * и типов, а слова к ним подбирает этот слой. Иначе перевод пришлось бы тащить
 * в симуляцию, которой однажды стоять на сервере без всякого экрана.
 */

export type Lang = 'ru' | 'en'

export type Dict = typeof RU
/** Ключ перевода. Проверяется типом: опечатка в ключе — ошибка сборки, а не пустая строка. */
export type Key = keyof Dict

const DICTS: Record<Lang, Dict> = { ru: RU, en: EN }

const STORAGE_KEY = 'elite.lang'

function initial(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'ru' || saved === 'en') return saved
  // Русский — язык оригинала. Гадать по `navigator.language` не станем: игра
  // писалась по-русски, и её тексты по-русски точнее.
  return navigator.language.startsWith('ru') ? 'ru' : 'en'
}

let lang: Lang = initial()
const listeners = new Set<() => void>()

export const currentLang = (): Lang => lang

export function setLang(next: Lang): void {
  if (next === lang) return
  lang = next
  localStorage.setItem(STORAGE_KEY, next)
  for (const listen of listeners) listen()
}

/** Подписка для React. Возвращает отписку — её же ждёт `useSyncExternalStore`. */
export function subscribeLang(listen: () => void): () => void {
  listeners.add(listen)
  return () => listeners.delete(listen)
}

/**
 * Слово по ключу. Подстановки — `{имя}`, потому что порядок слов в языках разный:
 * «ПРИЧАЛ 1.4 КМ» и «PAD 1.4 KM» ещё совпадают, а «ДО ЯДРА 46 СВ.Г.» и «46 LY TO
 * THE CORE» уже нет. Склеивать перевод из кусков — значит переводить грамматику.
 */
export function t(key: Key, params?: Record<string, string | number>): string {
  // Устойчивость к рантайм-ключам (`('kind.'+x) as Key` обходит проверку типов): пропущенный
  // в текущем языке ключ НЕ должен ронять UI (`undefined.toUpperCase()`). Падаем на русский
  // (базовый словарь), затем на сам ключ — видно, что перевода нет, но кадр цел.
  const line = DICTS[lang][key] ?? DICTS.ru[key] ?? String(key)
  if (!params) return line
  return line.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    return value === undefined ? whole : String(value)
  })
}
