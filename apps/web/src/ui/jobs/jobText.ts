import { CALENDAR_DAY, commodityById, TIME, type Contract, type ContractOffer, type ContractTerms } from '@elite/sim'
import { t, type Key } from '../i18n'
import { commodityName, properName } from '../i18n/dataNames'
import { formatGameDate } from '../i18n/date'

/**
 * Дело словами на языке игрока. Домен хранит карточку данными (что, куда, сколько) —
 * слова собираются только здесь, при показе: оферта в окне связи, строка на экране «ДЕЛА».
 */

function goodName(terms: ContractTerms): string {
  const good = 'commodityId' in terms ? commodityById(terms.commodityId) : null
  return good ? commodityName(good) : ''
}

/** Что говорит заказчик, предлагая дело. */
export function offerText(offer: ContractOffer): string {
  return t(`job.offer.${offer.kind}` as Key, {
    commodity: goodName(offer),
    units: 'units' in offer ? offer.units : 0,
    to: 'toSystemName' in offer ? properName(offer.toSystemName) : '',
    heads: offer.kind === 'hunt' ? offer.heads : 0,
    reward: offer.reward,
    days: offer.days ?? 0,
  })
}

export function kindLabel(c: Contract): string {
  return t(`jobs.kind.${c.terms.kind}` as Key)
}

/** Цель и ход дела одной строкой: «Металлы ×4 т → станция в Лаве», «Убрано 1 из 3». */
export function goalText(c: Contract): string {
  const terms = c.terms
  const p = c.progress
  return t(`jobs.goal.${terms.kind}` as Key, {
    commodity: goodName(terms),
    units: 'units' in terms ? terms.units : 0,
    to: 'toSystemName' in terms ? properName(terms.toSystemName) : '',
    system: properName(c.systemName),
    name: properName(c.giverName),
    done: p.kind === 'fetch' ? p.delivered : 0,
    kills: p.kind === 'hunt' ? p.kills : 0,
    heads: terms.kind === 'hunt' ? terms.heads : 0,
  })
}

export function rewardText(c: Contract): string {
  const key: Key = c.terms.kind === 'fetch' ? 'jobs.rewardTon' : c.terms.kind === 'hunt' ? 'jobs.rewardHead' : 'jobs.reward'
  return t(key, { reward: c.reward })
}

/** Срок датой календаря или «здесь и сейчас». */
export function deadlineText(c: Contract): string {
  if (c.deadline == null) return t('jobs.here')
  return t('jobs.deadline', { date: formatGameDate(TIME.EPOCH_MS + c.deadline * 1000 * TIME.SCALE) })
}

/** Сколько игровых суток осталось (для подсветки горящего срока). null — бессрочно. */
export function daysLeft(c: Contract, calendarTime: number): number | null {
  if (c.deadline == null || !Number.isFinite(calendarTime)) return null
  return (c.deadline - calendarTime) / CALENDAR_DAY
}
