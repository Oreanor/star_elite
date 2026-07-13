import { applyOrder, commandableByPlayer, type AIOrder } from '../ai/commands'
import { NOTE_MAX_CHARS, recordEvent } from '../world/acquaintance'
import type { ShipEntity, World } from '../world/entities'
import { applySocial, say, type Social, type Topic } from './dialogue'
import { applyTransfer, type Transfer, type TransferResult } from './transfer'

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

const ORDERS: readonly AIOrder[] = ['attack', 'engageAll', 'hold', 'standDown', 'keepBack', 'resume']
const TOPICS: readonly Topic[] = ['surrender', 'mercy', 'escort', 'plunder', 'greet']

/** Подтверждение приказа строкой в ленте. Текст — игровой контент, живёт с исполнением. */
const ORDER_DONE: Record<AIOrder, string> = {
  attack: 'Приказ: атаковать цель.',
  engageAll: 'Приказ: огонь по всем врагам.',
  hold: 'Приказ: ждать на месте.',
  standDown: 'Приказ: отбой, прекратить огонь.',
  keepBack: 'Приказ: держаться в хвосте.',
  resume: 'Приказ: действовать как обычно.',
}

function coerceTransfer(p: unknown): Transfer | null {
  const o = asObject(p)
  if (!o) return null
  const direction = o.direction === 'toThem' || o.direction === 'toYou' ? o.direction : null
  if (!direction) return null
  const units = typeof o.units === 'number' && o.units > 0 ? Math.floor(o.units) : 0
  const credits = typeof o.credits === 'number' && o.credits > 0 ? Math.floor(o.credits) : 0
  const commodityId = typeof o.commodityId === 'string' ? o.commodityId : null
  if (!(commodityId && units > 0) && credits <= 0) return null // пустая сделка — не сделка
  return { direction, commodityId, units, credits }
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

/** Просьба к боту (`Topic`): `say` катит кость, МУТИРУЕТ мир и даёт реплику + исход. */
function askCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const o = asObject(payload)
  const topic = o && TOPICS.includes(o.topic as Topic) ? (o.topic as Topic) : null
  if (!topic) return null
  const reply = say(world, ship, topic)
  // Болтовню (`greet`) в журнал не пишем — это не просьба, летопись бы захламилась.
  if (topic !== 'greet') recordEvent(world, ship, { kind: 'asked', topic, agreed: reply.agreed })
  return { line: null, agreed: reply.agreed, spoken: reply.text }
}

/** Приказ послушания СВОЕМУ эскорту. Чужому не прикажешь — домен стережёт, не UI. */
function orderCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const o = asObject(payload)
  const order = o && ORDERS.includes(o.order as AIOrder) ? (o.order as AIOrder) : null
  if (!order) return null
  if (!commandableByPlayer(ship, world.player.id)) return null
  const target = o && typeof o.target === 'number' ? o.target : null
  if (!applyOrder(ship, order, target)) return null
  recordEvent(world, ship, { kind: 'order', order })
  return { line: ORDER_DONE[order] }
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

// ─── Шина ────────────────────────────────────────────────────────────────────────

const HANDLERS: Record<string, CommandHandler> = {
  ask: askCommand,
  order: orderCommand,
  social: socialCommand,
  transfer: transferCommand,
  note: noteCommand,
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
