import { applyOrder, commandableByPlayer, type AIOrder } from '../ai/commands'
import { assignApproach, assignCollectRun, clearTasks } from '../ai/tasks'
import { NOTE_MAX_CHARS, recordEvent } from '../world/acquaintance'
import type { RawPlanStep } from '../world/contactPlan'
import { applyContactPlan } from '../world/plan'
import type { ShipEntity, World } from '../world/entities'
import { applyOutcome, applySocial, linesFor, say, type Social } from './dialogue'
import { coerceOrder, coerceTopic, coerceTransfer } from './payload'
import { applyTransfer, type TransferResult } from './transfer'

/**
 * КОМАНДА боту — единица «что игрок велел / о чём договорились» в диалоге: {действие, груз}.
 * Команд много и число растёт (сделка, приказ, просьба, факт; дальше — кошелёк, поручения),
 * а устроены они одинаково: тег `action` + произвольный `payload`. Поэтому НЕ функция на
 * каждую, а ОДНА шина `applyCommand` с реестром реализаций по тегу (OCP: новая команда —
 * новая запись в реестре, не правка вызова). Это же — будущее сетевое сообщение: негоциатор
 * (LLM, в app) команды РАСПОЗНАЁТ, а домен ИСПОЛНЯЕТ детерминированно, как по кнопке.
 */
export interface Command {
  action: string
  payload: unknown
}

/**
 * Что команда оставила для ленты диалога. Домен исполнил и, если нужно, вернул:
 * `line` — системную строку-подтверждение (что произошло), либо null — молча;
 * `agreed` — поддался ли бот (для команд-просьб), иначе undefined;
 * `spoken` — что бот ПРОИЗНОСИТ в ответ (канонная реплика домена), если задан.
 */
export interface CommandOutcome {
  line: string | null
  agreed?: boolean
  spoken?: string
}

export type CommandHandler = (world: World, ship: ShipEntity, payload: unknown) => CommandOutcome | null

// ─── Разбор произвольного payload ───────────────────────────────────────────────
// Команды приходят от модели/сети — домен им не верит и коротко перепроверяет всё сам.

function asObject(p: unknown): Record<string, unknown> | null {
  return typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : null
}

/** Радиус сбора груза по поручению, м — совпадает с кнопкой в диалоге. */
const TASK_COLLECT_RADIUS = 4000

/** Поручение эскорту в очередь задач (сбор, подлёт к цели, сброс). */
function taskCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const o = asObject(payload)
  const kind = o?.kind
  if (!commandableByPlayer(ship, world.player.id)) return null

  if (kind === 'collect-cargo') {
    if (!o) return null
    const radius = typeof o.radius === 'number' && o.radius > 0 ? o.radius : TASK_COLLECT_RADIUS
    if (!assignCollectRun(ship, ship.state.pos, radius)) return null
    return { line: null, spoken: 'ПРИНЯЛ. СОБИРАЮ И ИДУ К ТЕБЕ.' }
  }
  if (kind === 'approach-nav') {
    const navId = world.navTargetId
    if (navId == null) return null
    const body = world.bodies.find((b) => b.id === navId)
    if (!body) return null
    if (!assignApproach(ship, body.pos, body.radius)) return null
    return { line: null, spoken: 'ИДУ ТУДА.' }
  }
  if (kind === 'clear-tasks') {
    clearTasks(ship)
    return { line: null, spoken: 'ОТСТАВИЛ.' }
  }
  return null
}

function isTaskPlanStep(step: RawPlanStep): boolean {
  return step.step === 'collect' || step.step === 'approach-nav' || step.step === 'clear-tasks'
}

function taskPayloadFromPlanStep(step: RawPlanStep): Record<string, unknown> | null {
  if (step.step === 'collect') {
    return { kind: 'collect-cargo', radius: step.radius }
  }
  if (step.step === 'approach-nav') return { kind: 'approach-nav' }
  if (step.step === 'clear-tasks') return { kind: 'clear-tasks' }
  return null
}
/** Подтверждение приказа строкой в ленте. Текст — игровой контент, живёт с исполнением. */
const ORDER_DONE: Record<AIOrder, string> = {
  attack: 'Приказ: атаковать цель.',
  engageAll: 'Приказ: огонь по всем врагам.',
  hold: 'Приказ: ждать на месте.',
  standDown: 'Приказ: отбой, прекратить огонь.',
  keepBack: 'Приказ: держаться в хвосте.',
  resume: 'Приказ: действовать как обычно.',
}

/** Итог сделки строкой для ленты. null — ничего не перешло (обещал, да нечем). */
function transferLine(r: TransferResult): string | null {
  const parts: string[] = []
  if (r.units > 0 && r.commodityName) {
    parts.push(r.direction === 'toThem' ? `Передано: ${r.commodityName} ×${r.units}` : `Получено: ${r.commodityName} ×${r.units}`)
  }
  if (r.credits > 0) {
    parts.push(r.direction === 'toThem' ? `Списано: ${r.credits} кр` : `Зачислено: ${r.credits} кр`)
  }
  return parts.length ? parts.join(' · ') : null
}

// ─── Реализации команд ──────────────────────────────────────────────────────────

/** Просьба к боту (`Topic`): кнопка — `say` с костью; LLM — `applyOutcome` без кости. */
function askCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const o = asObject(payload)
  const topic = o ? coerceTopic(o.topic) : null
  if (!topic) return null

  if (o?.llm === true) {
    const line = linesFor(world, ship).find((l) => l.topic === topic)
    if (!line || line.blocked !== null) {
      return { line: null, agreed: false, spoken: line?.blocked ?? '…' }
    }
    const agreed = applyOutcome(world, ship, topic)
    if (topic !== 'greet') recordEvent(world, ship, { kind: 'asked', topic, agreed })
    const spoken = !agreed && topic === 'escort' ? 'ПОКАЖИ ДЕНЬГИ.' : undefined
    return { line: null, agreed, spoken }
  }

  const reply = say(world, ship, topic)
  // Болтовню (`greet`) в журнал не пишем — это не просьба, летопись бы захламилась.
  if (topic !== 'greet') recordEvent(world, ship, { kind: 'asked', topic, agreed: reply.agreed })
  return { line: null, agreed: reply.agreed, spoken: reply.text }
}

/** Приказ послушания СВОЕМУ эскорту. Чужому не прикажешь — домен стережёт, не UI. */
function orderCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const o = asObject(payload)
  const order = o ? coerceOrder(o.order) : null
  if (!order) return null
  if (!commandableByPlayer(ship, world.player.id)) return null
  const target = o && typeof o.target === 'number' ? o.target : null
  if (!applyOrder(ship, order, target)) return null
  recordEvent(world, ship, { kind: 'order', order })
  return { line: ORDER_DONE[order], spoken: 'ЕСТЬ, КОМАНДИР.' }
}

/** Соц-тон реплики игрока: нахамил/польстил. Следствие для отношений считает домен. */
function socialCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const o = asObject(payload)
  const tone: Social | null = o && (o.tone === 'insult' || o.tone === 'flatter') ? o.tone : null
  if (!tone) return null
  applySocial(world, ship, tone)
  recordEvent(world, ship, { kind: 'social', tone })
  return { line: null }
}

/** Передача добра. Журналим и показываем ТОЛЬКО реально перешедшее (домен урезал сам). */
function transferCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const t = coerceTransfer(payload)
  if (!t) return null
  const r = applyTransfer(world, ship, t)
  if (r.credits <= 0 && r.units <= 0) return null
  recordEvent(world, ship, {
    kind: 'deal',
    toPlayer: r.direction === 'toYou',
    credits: r.credits,
    commodityName: r.commodityName,
    units: r.units,
  })
  return { line: transferLine(r) }
}

/** Произвольный факт «запомни это» — короткой фразой (режем по `NOTE_MAX_CHARS`). */
function noteCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const o = asObject(payload)
  const raw = o && typeof o.text === 'string' ? o.text : null
  const text = raw ? raw.trim().slice(0, NOTE_MAX_CHARS) : ''
  if (!text) return null
  recordEvent(world, ship, { kind: 'note', text })
  return { line: null }
}

/**
 * Выучить мету переводчика: «их слово/оборот» → что делать по шагам.
 * Пишется в журнал тихо (без строки в ленте), чтобы при следующей встрече помнить смысл.
 */
function learnCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const o = asObject(payload)
  const raw = o && typeof o.text === 'string' ? o.text : typeof payload === 'string' ? payload : null
  const body = raw ? raw.trim().slice(0, NOTE_MAX_CHARS - 5) : ''
  if (!body) return null
  recordEvent(world, ship, { kind: 'note', text: `МЕТА: ${body}` })
  return { line: null }
}

/** Макро-план: купить, вылететь, прикрывать — компилируется и исполняется доменом. */
function planCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const o = asObject(payload)
  const steps = o && Array.isArray(o.steps) ? (o.steps as RawPlanStep[]) : []
  if (steps.length === 0) return null

  const taskSteps = steps.filter(isTaskPlanStep)
  const planSteps = steps.filter((s) => !isTaskPlanStep(s))
  const spoken: string[] = []
  const system: string[] = []

  for (const ts of taskSteps) {
    const taskPayload = taskPayloadFromPlanStep(ts)
    if (!taskPayload) return { line: 'Не могу выполнить поручение.' }
    const out = taskCommand(world, ship, taskPayload)
    if (!out) return { line: 'Не могу выполнить поручение.' }
    if (out.spoken) spoken.push(out.spoken)
  }

  if (planSteps.length > 0) {
    const result = applyContactPlan(world, ship, planSteps)
    if (!result.accepted && taskSteps.length === 0) {
      return { line: 'Не могу выполнить: нет условий или непонятный модуль.' }
    }
    if (result.accepted) {
      recordEvent(world, ship, { kind: 'note', text: 'принял поручение из разговора' })
      if (result.lines.length) system.push(...result.lines)
      else system.push('Принято.')
    }
  } else if (taskSteps.length > 0) {
    recordEvent(world, ship, { kind: 'note', text: 'принял поручение из разговора' })
  }

  return {
    line: system.length ? system.join(' · ') : null,
    spoken: spoken.length ? spoken.join(' ') : undefined,
  }
}

// ─── Шина ────────────────────────────────────────────────────────────────────────

const HANDLERS: Record<string, CommandHandler> = {
  ask: askCommand,
  order: orderCommand,
  task: taskCommand,
  social: socialCommand,
  transfer: transferCommand,
  note: noteCommand,
  learn: learnCommand,
  plan: planCommand,
}

/**
 * Исполнить команду боту. Неизвестный тег — молча null: старый клиент/сеть могут прислать
 * команду, которой этот домен ещё не знает, и это не повод падать. Результат — для ленты.
 */
export function applyCommand(world: World, ship: ShipEntity, command: Command): CommandOutcome | null {
  const handler = HANDLERS[command.action]
  return handler ? handler(world, ship, command.payload) : null
}

/** Зарегистрировать новую команду. Новая способность бота — запись СЮДА, а не правка шины. */
export function registerCommand(action: string, handler: CommandHandler): void {
  HANDLERS[action] = handler
}
