import { currentLang } from './i18n'

/**
 * Игровая дата словами. Строим НЕ подстановкой `{d} {m} {y}`, а отдельной сборкой на
 * язык: порядок и форма частей разные — RU ставит день перед месяцем в родительном
 * падеже и добавляет «года», EN — месяц первым и запятую. Склеивать это шаблоном
 * значило бы переводить грамматику (та же причина, что у `t`).
 */

/** Месяцы в РОДИТЕЛЬНОМ падеже: «21 сентября», а не «21 сентябрь». */
const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Дата из мс (UTC-эпоха календаря). Читаем в UTC: эпоха задана `Date.UTC`, и
 * местная зона игрока не должна сдвигать общую для всех дату мира.
 */
export function formatGameDate(ms: number): string {
  const d = new Date(ms)
  const day = d.getUTCDate()
  const month = d.getUTCMonth()
  const year = d.getUTCFullYear()
  if (currentLang() === 'ru') return `${day} ${MONTHS_RU[month]} ${year} года`
  return `${MONTHS_EN[month]} ${day}, ${year}`
}
