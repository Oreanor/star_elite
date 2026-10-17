/**
 * ФРАЗА — то, что домен говорит игроку, без языка. Домен решает, ЧТО сказано (код и
 * числа), а слова на языке игрока подбирает `ui` (`phrase.<key>` в словарях). Прежде домен
 * отдавал готовые русские строки — и игрок на английском читал «ПОКАЖИ ДЕНЬГИ.».
 *
 * Набор ключей закрыт: словари `ui` типизированы по нему, и фраза без перевода не соберётся.
 * Параметры — числа и ИДЕНТИФИКАТОРЫ (товар, модуль), не готовые имена: имя на нужном языке
 * тоже подберёт `ui`. `and` — цепочка: «Получено … · Зачислено …» одной строкой.
 */
export type PhraseKey =
  // Сделки и подтверждения в ленте
  | 'dealGave' | 'dealGot' | 'dealCharged' | 'dealCredited'
  | 'orderAttack' | 'orderEngageAll' | 'orderHold' | 'orderStandDown' | 'orderKeepBack' | 'orderResume'
  | 'mapEdited' | 'finePaidLine' | 'taskCannot' | 'taskNoTerms' | 'taskAccepted'
  | 'planInstalled' | 'planJoin' | 'planUndock' | 'foeSurrendered' | 'foeFled' | 'foeTurned'
  | 'jobDeclined' | 'jobDeclinedAngry' | 'jobHoldFullLine' | 'jobAccepted'
  | 'giftReceived' | 'meetLine'
  // Реплики собеседника, которые звучат от домена
  | 'ellipsis' | 'notHired' | 'taskCollect' | 'taskGoTo' | 'taskComeTo' | 'taskCancelled' | 'orderAck'
  | 'fineNone' | 'fineQuote' | 'fineShort' | 'finePaid'
  | 'jobNone' | 'jobHoldFull' | 'jobBusy' | 'jobRemote'
  | 'giftUnworthy' | 'giftGiven' | 'giftHoldFull'
  | 'showMoney' | 'hireAgree' | 'surrenderRefuse' | 'surrenderAgree'
  | 'mercyRefuse' | 'mercyCargo' | 'mercyEmpty'
  | 'plunderGuardsHostile' | 'plunderGuards' | 'plunderFlee' | 'plunderAll' | 'plunderNothing'
  | 'greetEscort' | 'greetHostile' | 'greetWary' | 'greetWarm' | 'greetNeutral'
  // Кнопки игрока и почему недоступны
  | 'sayStopFire' | 'sayMercy' | 'sayHire' | 'sayHireFee' | 'sayPlunder'
  | 'blockedUnharmed' | 'blockedMakePeace' | 'blockedNoCredits'

export type PhraseParams = Readonly<Record<string, string | number>>

export interface Phrase {
  readonly key: PhraseKey
  readonly params?: PhraseParams
  /** Следующая фраза той же строки. */
  readonly and?: Phrase
}

export function phrase(key: PhraseKey, params?: PhraseParams): Phrase {
  return params ? { key, params } : { key }
}

/** `a`, затем `b` — `b` пристёгивается в хвост цепочки `a`, её собственная не теряется. */
function concat(a: Phrase, b: Phrase): Phrase {
  return { ...a, and: a.and ? concat(a.and, b) : b }
}

/** Склеить фразы в одну строку (цепочкой `and`). Пусто — null. */
export function joinPhrases(list: readonly Phrase[]): Phrase | null {
  let out: Phrase | null = null
  for (let i = list.length - 1; i >= 0; i--) out = out ? concat(list[i]!, out) : list[i]!
  return out
}
