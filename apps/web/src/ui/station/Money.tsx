import { Fragment, type ReactNode } from 'react'
import { currentLang, t, type Key } from '../i18n'

/**
 * Деньги — значком монетки перед суммой, а не «кр.» после неё. Одна форма на всё: цены,
 * выручку, кошелёк в шапке. Разряды разбиты, как у кошелька («5 000 000»), чтобы шесть
 * знаков читались с одного взгляда.
 */

/** Монетка: стоячий овал с ребром — монета, повёрнутая чуть боком. Цвет — от текста. */
export function Coin() {
  return (
    <svg
      viewBox="0 0 10 14"
      className="inline-block h-[0.95em] w-[0.68em] shrink-0 self-center"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
    >
      <ellipse cx="5" cy="7" rx="3.8" ry="6" />
      <ellipse cx="5" cy="7" rx="1.6" ry="3" strokeWidth={1} />
    </svg>
  )
}

/** Число с разбивкой разрядов по языку интерфейса. */
export function moneyNumber(amount: number): string {
  return Math.round(amount).toLocaleString(currentLang() === 'ru' ? 'ru' : 'en-US')
}

/** Сумма: монетка и число. Не переносится — «монетка / 52 000» на двух строках читалось бы как два значения. */
export function Money({ amount, sign }: { amount: number; sign?: '+' | '−' }) {
  return (
    <span className="inline-flex items-baseline gap-2 whitespace-nowrap tabular-nums">
      {sign}
      <Coin />
      {moneyNumber(amount)}
    </span>
  )
}

/**
 * Перевод, где подстановка может быть узлом: «Купить «{name}» за {price}?» с монеткой на
 * месте {price}. Обычный `t` склеивает строку и картинку в неё не вставит, поэтому шаблон
 * режем по подстановкам и собираем из кусков.
 */
export function tm(key: Key, params: Record<string, ReactNode>): ReactNode {
  const parts = t(key).split(/\{(\w+)\}/)
  return parts.map((part, i) =>
    // Нечётные куски — имена подстановок, чётные — текст между ними.
    i % 2 === 1 ? <Fragment key={i}>{params[part] ?? `{${part}}`}</Fragment> : part,
  )
}
