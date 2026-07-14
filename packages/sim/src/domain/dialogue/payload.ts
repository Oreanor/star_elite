import type { AIOrder } from '../ai/commands'
import type { Topic } from './dialogue'
import type { Transfer } from './transfer'
import type { RawPlanStep } from '../world/contactPlan'

/** Просьбы к боту — единый whitelist для шины и парсера LLM. */
export const DIALOGUE_TOPICS: readonly Topic[] = ['surrender', 'mercy', 'escort', 'plunder']

/** Приказы послушания — единый whitelist для шины и парсера LLM. */
export const AI_ORDERS: readonly AIOrder[] = ['attack', 'engageAll', 'hold', 'standDown', 'keepBack', 'resume']

/** Справочники, которые модель может запросить через lookup. */
export const LOOKUP_DIGESTS = ['market', 'neighbours', 'history', 'worlds'] as const
export type LookupDigest = (typeof LOOKUP_DIGESTS)[number]

function asObject(p: unknown): Record<string, unknown> | null {
  return typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : null
}

export function coerceTopic(raw: unknown): Topic | null {
  return typeof raw === 'string' && DIALOGUE_TOPICS.includes(raw as Topic) ? (raw as Topic) : null
}

export function coerceOrder(raw: unknown): AIOrder | null {
  return typeof raw === 'string' && AI_ORDERS.includes(raw as AIOrder) ? (raw as AIOrder) : null
}

export function coerceLookup(raw: unknown): LookupDigest | null {
  return typeof raw === 'string' && (LOOKUP_DIGESTS as readonly string[]).includes(raw) ? (raw as LookupDigest) : null
}

/** Разобрать сделку из JSON модели. Домен при исполнении перепроверит трюмы и кредиты. */
export function coerceTransfer(raw: unknown): Transfer | null {
  const o = asObject(raw)
  if (!o) return null
  const direction = o.direction === 'toThem' || o.direction === 'toYou' ? o.direction : null
  if (!direction) return null
  const units = typeof o.units === 'number' && o.units > 0 ? Math.floor(o.units) : 0
  const credits = typeof o.credits === 'number' && o.credits > 0 ? Math.floor(o.credits) : 0
  const commodityId = typeof o.commodityId === 'string' ? o.commodityId : null
  if (!(commodityId && units > 0) && credits <= 0) return null
  return { direction, commodityId, units, credits }
}

/** Разобрать шаги макро-плана из JSON модели. */
export function coercePlanSteps(raw: unknown): RawPlanStep[] {
  if (!Array.isArray(raw)) return []
  const out: RawPlanStep[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const step = o.step
    if (step === 'dock') out.push({ step: 'dock' })
    else if (step === 'undock') out.push({ step: 'undock' })
    else if (step === 'buy' && typeof o.module === 'string') {
      out.push({
        step: 'buy',
        module: o.module,
        hardpoint: typeof o.hardpoint === 'number' ? o.hardpoint : undefined,
      })
    } else if (step === 'escort') {
      out.push({ step: 'escort', cover: o.cover === true })
    } else if (step === 'goto-system' && typeof o.systemIndex === 'number') {
      out.push({ step: 'goto-system', systemIndex: o.systemIndex })
    } else if (step === 'collect') {
      out.push({
        step: 'collect',
        radius: typeof o.radius === 'number' ? o.radius : undefined,
      })
    } else if (step === 'approach-nav') {
      out.push({ step: 'approach-nav' })
    } else if (step === 'clear-tasks') {
      out.push({ step: 'clear-tasks' })
    }
  }
  return out
}

/** Поручение непонятно через переводчик — только переспрос, без исполнения. */
export function coerceClarify(raw: unknown): boolean {
  return raw === true
}

/** Тихая мета-запись: как понял чужое слово/оборот → что делать по шагам. */
export function coerceLearn(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t ? t : null
}

/** Найм списывает плату сам — не дублируем credits в transfer при эскорте. */
export function sanitizeEscortTransfer(t: Transfer | null, intent: Topic | null): Transfer | null {
  if (!t || intent !== 'escort') return t
  if (t.commodityId && (t.units ?? 0) > 0) return { ...t, credits: 0 }
  if ((t.credits ?? 0) > 0) return null
  return t
}
