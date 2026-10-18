import { phrase, type Phrase } from '../dialogue/phrase'
import type { ShipEntity, World } from '../world/entities'
import {
  brokenModules,
  copilotApproach,
  copilotAttack,
  copilotCollect,
  copilotFlee,
  copilotGoto,
  copilotRepair,
  copilotRepairAll,
  copilotRepairQuote,
  copilotSalary,
  copilotStop,
  requestDismiss,
  hireCopilot,
  type HireBlock,
  type OrderResult,
  type RepairTarget,
} from './copilot'

/**
 * Команды экипажа для шины диалога (`commandBus`). Модель распознаёт просьбу в речи игрока,
 * домен исполняет — как у любого бота. Ответ домена ЗВУЧИТ, если приказ не прошёл: модель
 * могла сказать «есть!», а врагов на локаторе нет — игрок слышит правду, а не поддакивание.
 */

/** Исход команды — та же форма, что у `CommandOutcome` шины (без импорта по кругу). */
interface Outcome {
  line: Phrase | null
  spoken?: Phrase
  ends?: boolean
}

function asObject(p: unknown): Record<string, unknown> | null {
  return typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : null
}

const HIRE_REFUSAL: Record<Exclude<HireBlock, 'not-pilot' | 'hostile'>, (world: World, ship: ShipEntity) => Phrase> = {
  taken: () => phrase('hireTaken'),
  wary: () => phrase('hireWary'),
  rank: () => phrase('hireRank'),
  money: (_world, ship) => phrase('hireMoney', { salary: copilotSalary(ship.rank) }),
}

/** Бот согласился пойти вторым пилотом (`crew: join`). Условия проверяет домен. */
export function crewCommand(world: World, ship: ShipEntity, payload: unknown): Outcome | null {
  if (asObject(payload)?.join !== true) return null
  const salary = copilotSalary(ship.rank)
  const block = hireCopilot(world, ship)
  if (block === 'not-pilot' || block === 'hostile') return null
  if (block) return { line: null, spoken: HIRE_REFUSAL[block](world, ship) }
  // Он уходит к тебе в кабину — канал с его бортом закрыт, дальше говорить с ним по P.
  return { line: phrase('copilotHired', { name: ship.pilotName, salary }), ends: true }
}

const ORDER_FAIL: Record<Exclude<OrderResult, 'ok'>, Phrase | null> = {
  'no-copilot': null,
  docked: phrase('copilotDocked'),
  'no-target': phrase('copilotNoTarget'),
  'no-foes': phrase('copilotNoFoes'),
  'no-pods': phrase('copilotNoPods'),
  'hold-full': phrase('copilotHoldFull'),
}

function orderOutcome(result: OrderResult, done: Phrase): Outcome | null {
  if (result === 'ok') return { line: done }
  const fail = ORDER_FAIL[result]
  return fail ? { line: null, spoken: fail } : null
}

/** Что чинить по слову модели: `hull`, `all` или номер сломанной детали из сводки (с 1). */
function repairTargetOf(world: World, raw: unknown): RepairTarget | 'all' | null {
  if (raw === 'hull') return { kind: 'hull' }
  if (raw === 'all') return 'all'
  if (typeof raw === 'number') {
    const module = brokenModules(world)[Math.floor(raw) - 1]
    return module ? { kind: 'module', module } : null
  }
  return null
}

function repairOutcome(world: World, raw: unknown): Outcome | null {
  const target = repairTargetOf(world, raw)
  if (!target) return { line: null, spoken: phrase('copilotNothingToRepair') }
  if (target === 'all') {
    const r = copilotRepairAll(world)
    const why = r.short ? phrase('copilotRepairShort') : r.partial ? phrase('copilotRepairAgain') : undefined
    if (r.fixed === 0) return { line: null, spoken: why ?? phrase('copilotNothingToRepair') }
    return { line: phrase('copilotRepaired', { credits: r.spent }), spoken: why }
  }
  const price = copilotRepairQuote(world, target)?.price ?? 0
  const r = copilotRepair(world, target)
  if (r.result === 'repaired') return { line: phrase('copilotRepaired', { credits: r.spent }) }
  if (r.result === 'partial') {
    return {
      line: phrase('copilotRepairedPartial', { credits: r.spent, pct: Math.max(1, Math.round(r.left * 100)) }),
      spoken: phrase('copilotRepairAgain'),
    }
  }
  if (r.result === 'no-money') return { line: null, spoken: phrase('copilotNoMoney', { credits: price }) }
  if (r.result === 'nothing') return { line: null, spoken: phrase('copilotNothingToRepair') }
  return null
}

/**
 * Приказ второму пилоту. Борт в сигнатуре — тот, которым он правит (твой), сам приказ
 * обращается к миру: второй пилот — член экипажа, а не корабль.
 */
export function copilotCommand(world: World, _ship: ShipEntity, payload: unknown): Outcome | null {
  const o = asObject(payload)
  if (!o || !world.copilot) return null
  // Отдал другой приказ — значит, не увольняет: вопрос «точно?» снят.
  if (o.order !== 'dismiss') world.copilot.dismissAskedAt = undefined
  switch (o.order) {
    case 'goto':
      return typeof o.id === 'number' ? orderOutcome(copilotGoto(world, o.id), phrase('copilotGoto')) : null
    case 'approach':
      return typeof o.id === 'number' ? orderOutcome(copilotApproach(world, o.id), phrase('copilotApproach')) : null
    case 'attack': {
      const target = o.target === 'nearest' || o.target === 'all' || typeof o.target === 'number' ? o.target : null
      if (target === null) return null
      return orderOutcome(copilotAttack(world, target), phrase(target === 'all' ? 'copilotAttackAll' : 'copilotAttack'))
    }
    case 'collect':
      return orderOutcome(copilotCollect(world), phrase('copilotCollect'))
    case 'flee':
      return orderOutcome(copilotFlee(world), phrase('copilotFlee'))
    case 'stop':
      return orderOutcome(copilotStop(world), phrase('copilotStop'))
    case 'repair':
      return repairOutcome(world, o.target)
    case 'dismiss': {
      const name = world.copilot.name
      if (requestDismiss(world) === 'ask') return { line: null, spoken: phrase('copilotDismissConfirm') }
      return { line: phrase('copilotDismissed', { name }), ends: true }
    }
  }
  return null
}
