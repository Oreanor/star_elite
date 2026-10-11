import { TRAITS } from '../../config/ai'
import { clamp } from '../../core/math'
import type { Persona } from '../world/persona'
import type { ShipEntity } from '../world/entities'

/**
 * ХАРАКТЕР В ПОЛЁТЕ. Персона раньше жила только в разговоре: ум, темперамент и харизма
 * уходили в промпт модели, а ловкость и точность, хоть и были описаны, не читал никто.
 * Получалось, что характер у бота есть, пока с ним говоришь, а в бою все одинаковые.
 *
 * Здесь черты персоны сворачиваются в несколько множителей, которые читают поведения и
 * рулёжка. Все они — про РЕШЕНИЕ, не про физику: угловая скорость, урон и тяга у всех те
 * же (правило «бот выигрывает решением, не привилегией»).
 *
 * Чистая функция от персоны — без кэша: персона может смениться (знакомого воссоздают
 * с записью), а пересчёт — пара умножений.
 */
export interface PilotTraits {
  /** Тяга к драке, ~0.5..1.6: вспыльчивый и храбрый лезут в бой охотнее, трус — нет. */
  aggression: number
  /** Жадность, 0..1: насколько контейнер с добром перевешивает прочие дела. */
  greed: number
  /** Кучность, множитель разброса прицела, ~0.75..1.3 (меньше — точнее). */
  spread: number
  /** Крутизна руля, ~0.85..1 (не выше единицы: потолок разворота общий для всех). */
  reflex: number
  /** Множитель времени реакции, ~0.9..1.15: умный пересматривает решение чуть чаще. */
  reaction: number
  /** Расчётливость, 0..1: бережёт ракеты для верной дистанции, раньше уходит из проигранного. */
  prudence: number
}

/** Черта 1..5 → −1..+1 (середина 3 — ноль). */
const centred = (v: number): number => clamp((v - 3) / 2, -1, 1)

export function traitsOf(p: Persona, out: PilotTraits): PilotTraits {
  const temper = centred(p.temperament)
  const nerve = p.disposition === 'brave' ? 1 : p.disposition === 'cowardly' ? -1 : 0
  const hot = p.disposition === 'hotheaded' ? 1 : 0
  out.aggression = clamp(
    1 + TRAITS.TEMPER_AGGRESSION * temper + TRAITS.NERVE_AGGRESSION * nerve + TRAITS.HOT_AGGRESSION * hot,
    0.5,
    1.6,
  )
  out.greed = p.disposition === 'greedy' ? 1 : TRAITS.BASE_GREED
  out.spread = 1 - TRAITS.ACCURACY_SPREAD * centred(p.accuracy)
  // Ловкость 5 — единица, ловкость 1 — минус AGILITY_REFLEX: выше единицы не бывает.
  out.reflex = 1 - TRAITS.AGILITY_REFLEX * (1 - centred(p.agility)) * 0.5
  out.reaction = 1 - TRAITS.INTELLECT_REACTION * centred(p.intellect)
  out.prudence = clamp((p.disposition === 'calculating' ? 0.6 : 0) + 0.2 * centred(p.intellect) + 0.2, 0, 1)
  return out
}

// Модульный результат: черты читают в каждом такте у каждого бота — без него это объект на
// бот на такт. Наружу отдаётся ссылка, её не хранят: следующий вызов перепишет.
const _traits: PilotTraits = { aggression: 1, greed: 0, spread: 1, reflex: 1, reaction: 1, prudence: 0 }

/** Черты пилота корабля. Возвращает МОДУЛЬНЫЙ объект — читать сразу, не хранить. */
export function pilotTraits(e: ShipEntity): PilotTraits {
  return traitsOf(e.persona, _traits)
}
