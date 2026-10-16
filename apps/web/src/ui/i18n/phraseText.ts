import { commodityById, findModule, type Phrase, type PhraseKey, type PhraseParams } from '@elite/sim'
import { commodityName, moduleName, properName } from './dataNames'
import { t } from './i18n'
import type { RU } from './ru'

/**
 * Фраза домена → слова на языке игрока. Домен отдаёт код и числа/идентификаторы, слова — здесь.
 *
 * Ключ `phrase.<код>` проверяется ТИПОМ: код без перевода в словаре — ошибка сборки, а не
 * «phrase.showMoney» на экране. Идентификаторы в параметрах (товар, модуль, имя) переводятся
 * своими словарями: имя товара на языке игрока, а не русский канон каталога.
 */
type PhraseI18nKey = `phrase.${PhraseKey}`
// Каждый код фразы обязан иметь строку в базовом словаре — иначе здесь ошибка типа.
const _everyPhraseTranslated: PhraseI18nKey extends keyof typeof RU ? true : never = true
void _everyPhraseTranslated

function localized(params: PhraseParams | undefined): Record<string, string | number> | undefined {
  if (!params) return undefined
  const out: Record<string, string | number> = { ...params }
  if (typeof params.commodity === 'string') {
    const c = commodityById(params.commodity)
    if (c) out.commodity = commodityName(c)
  }
  if (typeof params.module === 'string') {
    const m = findModule(params.module)
    if (m) out.module = moduleName(m)
  }
  if (typeof params.name === 'string') out.name = properName(params.name)
  return out
}

/**
 * @param sep Чем сшивать цепочку `and`: « · » в системной строке ленты, пробел — в реплике.
 */
export function phraseText(p: Phrase, sep = ' · '): string {
  const head = t(`phrase.${p.key}` as PhraseI18nKey, localized(p.params))
  return p.and ? `${head}${sep}${phraseText(p.and, sep)}` : head
}

/** Реплика собеседника: слова модели (уже на языке игрока) или фраза домена. */
export function utteranceText(u: string | Phrase): string {
  return typeof u === 'string' ? u : phraseText(u, ' ')
}
