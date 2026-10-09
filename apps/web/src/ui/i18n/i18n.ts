import { RU } from './ru'
import { DATA as RU_DATA } from './data/ru'
import type { LangData } from './data/types'

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

export type Lang = 'ru' | 'en' | 'pt' | 'fr' | 'de' | 'es' | 'it'

export type Dict = typeof RU
/** Ключ перевода. Проверяется типом: опечатка в ключе — ошибка сборки, а не пустая строка. */
export type Key = keyof Dict

/** Всё, что язык несёт интерфейсу: словарь хрома и перевод данных. */
interface Pack {
  dict: Dict
  data: LangData
}

/**
 * Загруженные языки. Русский — всегда: это базовый словарь и откат для пропусков. Прочие
 * шесть грузятся ПО ТРЕБОВАНИЮ отдельными кусками сборки — игроку незачем качать и
 * разбирать языки, на которых он не играет.
 *
 * Каждый словарь типизирован `Record<keyof typeof RU, string>` — компилятор ЗАСТАВЛЯЕТ его
 * нести ВСЕ ключи RU: пропуск перевода в любом языке — ошибка сборки, а не пустая строка в бою.
 */
const PACKS: Partial<Record<Lang, Pack>> = { ru: { dict: RU, data: RU_DATA } }

const LOADERS: Record<Exclude<Lang, 'ru'>, () => Promise<Pack>> = {
  en: async () => ({ dict: (await import('./en')).EN, data: (await import('./data/en')).DATA }),
  pt: async () => ({ dict: (await import('./pt')).PT, data: (await import('./data/pt')).DATA }),
  fr: async () => ({ dict: (await import('./fr')).FR, data: (await import('./data/fr')).DATA }),
  de: async () => ({ dict: (await import('./de')).DE, data: (await import('./data/de')).DATA }),
  es: async () => ({ dict: (await import('./es')).ES, data: (await import('./data/es')).DATA }),
  it: async () => ({ dict: (await import('./it')).IT, data: (await import('./data/it')).DATA }),
}

/** Подгрузить язык, если его ещё нет. Старт ждёт язык игрока до первого кадра. */
export async function loadLang(next: Lang): Promise<void> {
  if (PACKS[next] || next === 'ru') return
  PACKS[next] = await LOADERS[next]()
}

const pack = (): Pack => PACKS[lang] ?? PACKS.ru!

/** Перевод данных на текущий язык (см. `dataNames`). Не загружен — русский канон. */
export const langData = (): LangData => pack().data
/** Русские данные — откат для пропусков в переводе данных. */
export const RU_LANG_DATA: LangData = RU_DATA

const LANGS: readonly Lang[] = ['ru', 'en', 'pt', 'fr', 'de', 'es', 'it']

const STORAGE_KEY = 'elite.lang'

function initial(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && (LANGS as readonly string[]).includes(saved)) return saved as Lang
  // Подбираем по языку браузера (`pt-BR` → `pt`); чего не знаем — английский. Русский особо
  // не выделяем в угадывании: тексты у всех языков полные, пусть решает локаль системы.
  const code = navigator.language.slice(0, 2).toLowerCase()
  return (LANGS as readonly string[]).includes(code) ? (code as Lang) : 'en'
}

let lang: Lang = initial()
const listeners = new Set<() => void>()

export const currentLang = (): Lang => lang

/** Язык, к которому идёт переключение: быстрые щелчки подряд не должны лечь в обратном порядке. */
let wanted: Lang = lang

export async function setLang(next: Lang): Promise<void> {
  wanted = next
  await loadLang(next)
  if (wanted !== next || next === lang) return
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
  const line = pack().dict[key] ?? RU[key] ?? String(key)
  if (!params) return line
  return line.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    return value === undefined ? whole : String(value)
  })
}
