import { applyOrder, commandableByPlayer, type AIOrder } from '../ai/commands'
import { assignApproach, assignCollectRun, assignRendezvous, clearTasks } from '../ai/tasks'
import {
  applyStance,
  entrustCargo,
  NOTE_MAX_CHARS,
  recordEvent,
  releaseCargo,
  rememberPilot,
} from '../world/acquaintance'
import { pushEdit, type GalaxyEdit } from '../galaxy/delta'
import type { RawPlanStep } from '../world/contactPlan'
import { acquaintanceOf, applyContactPlan } from '../world/plan'
import type { ShipEntity, World } from '../world/entities'
import { beginWarpDeparture } from '../world/warp'
import { WARP } from '../../config/ai'
import { applyOutcome, applySocial, linesFor, say, type Social } from './dialogue'
import { coerceOrder, coerceStance, coerceTopic, coerceTransfer } from './payload'
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
  /**
   * Поручения берёт только НАНЯТЫЙ (есть уговор — `escortOf`). Но отказ обязан ЗВУЧАТЬ: раньше
   * приказ пропадал молча, а модель уже отвечала «иду!» — и бот выглядел вруном, хотя домен
   * просто отказал. Теперь игрок слышит причину и понимает, что надо сперва договориться.
   */
  if (!commandableByPlayer(ship, world.player.id)) {
    return { line: null, spoken: 'МЫ НЕ УГОВАРИВАЛИСЬ. НАЙМИ — ТОГДА ПОЛЕЧУ.' }
  }

  if (kind === 'collect-cargo') {
    if (!o) return null
    const radius = typeof o.radius === 'number' && o.radius > 0 ? o.radius : TASK_COLLECT_RADIUS
    if (!assignCollectRun(ship, ship.state.pos, radius)) return null
    return { line: null, spoken: 'ПРИНЯЛ. СОБИРАЮ И ИДУ К ТЕБЕ.' }
  }
  if (kind === 'approach-nav') {
    const navId = world.navTargetId
    if (navId == null) return null
    // Тело отдаём ПО ID: станция едет по орбите, и бот обязан пересчитывать подлёт на ходу.
    if (!world.bodies.some((b) => b.id === navId)) return null
    if (!assignApproach(ship, navId)) return null
    return { line: null, spoken: 'ИДУ ТУДА.' }
  }
  if (kind === 'come-to-me') {
    // «Подлети ко мне» — к ЖИВОМУ игроку, а не к нав-цели: раньше такого приказа не было
    // вовсе, и бот брал `approach-nav`, улетая мимо игрока к станции.
    if (!assignRendezvous(ship, world.player.id)) return null
    return { line: null, spoken: 'ИДУ К ТЕБЕ.' }
  }
  if (kind === 'clear-tasks') {
    clearTasks(ship)
    return { line: null, spoken: 'ОТСТАВИЛ.' }
  }
  return null
}

function isTaskPlanStep(step: RawPlanStep): boolean {
  return (
    step.step === 'collect' ||
    step.step === 'approach-nav' ||
    step.step === 'come' ||
    step.step === 'clear-tasks'
  )
}

function taskPayloadFromPlanStep(step: RawPlanStep): Record<string, unknown> | null {
  if (step.step === 'collect') {
    return { kind: 'collect-cargo', radius: step.radius }
  }
  if (step.step === 'approach-nav') return { kind: 'approach-nav' }
  if (step.step === 'come') return { kind: 'come-to-me' }
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
    // Покупка: груз toYou, но деньги с игрока — смотрим creditsFromPlayer, не direction.
    parts.push(r.creditsFromPlayer ? `Списано: ${r.credits} кр` : `Зачислено: ${r.credits} кр`)
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

/**
 * Бот САМ переменил отношение к командиру — оттаял или озлобился по ходу беседы.
 * Это не тон одной реплики (`social`), а сдвиг стойки: расположился, насторожился, озверел.
 * Модель ставит его РЕДКО и в характере; домен исполняет детерминированно (`applyStance`
 * при 'hostile' и мирной фракции — сам переведёт борт во враги и распустит эскорт).
 * Запись в журнал нужна, чтобы при следующей встрече помнить, отчего отношение таким стало.
 */
function stanceCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const o = asObject(payload)
  const stance = o ? coerceStance(o.stance) : null
  if (!stance) return null
  applyStance(world, ship, stance)
  recordEvent(world, ship, { kind: 'note', text: `переменил отношение → ${stance}` })
  return { line: null }
}

/**
 * ПРАВКА КАРТЫ ВСЕЛЕННОЙ богом — двигать/красить/переименовать/убрать звезду. Только бог
 * (`ship.divine`): смертный карту мироздания не трогает. Правка ложится в дельту поверх сида
 * (база не мутирует, откат возможен), а `galaxyEpoch` растёт — читатели карты пересоберут
 * эффективную галактику. Цель по индексу; без индекса — ТЕКУЩАЯ система (где стоит игрок).
 */
function mapEditCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  if (!ship.divine) return null
  const o = asObject(payload)
  if (!o) return null
  const index = typeof o.index === 'number' ? Math.floor(o.index) : world.systemIndex
  if (index < 0) return null

  let edit: GalaxyEdit | null = null
  if (o.op === 'recolor' && typeof o.color === 'number') {
    edit = { op: 'recolor', index, color: Math.floor(o.color) & 0xffffff }
  } else if (o.op === 'rename' && typeof o.name === 'string' && o.name.trim()) {
    edit = { op: 'rename', index, name: o.name.trim().slice(0, 40) }
  } else if (o.op === 'move' && typeof o.x === 'number' && typeof o.y === 'number' && typeof o.z === 'number') {
    edit = { op: 'move', index, x: o.x, y: o.y, z: o.z }
  } else if (o.op === 'remove') {
    edit = { op: 'remove', index }
  }
  if (!edit) return null

  pushEdit(world.galaxyDelta, edit)
  world.galaxyEpoch++
  return { line: 'Воля бога переменила карту мироздания.' }
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

  /**
   * УЧЁТ ДОВЕРЕННОГО. Груз ушёл к нему и НИ КРЕДИТА не пришло навстречу — это не продажа,
   * а «повези моё»: записываем за ним. Пришёл груз обратно — списываем.
   *
   * Различение по деньгам, а не по словам: сделка «товар за кредиты» атомарна и деньги в
   * ней идут навстречу грузу (см. `applyTransfer`), поэтому нулевая встречная сумма —
   * надёжный признак, что вещь отдана без расчёта. Никакой отдельной команды «на хранение»
   * модели знать не нужно.
   */
  const record = acquaintanceOf(world, ship)
  if (record && r.units > 0 && t.commodityId) {
    if (r.direction === 'toThem' && r.credits <= 0) entrustCargo(record, t.commodityId, r.units)
    else if (r.direction === 'toYou') releaseCargo(record, t.commodityId, r.units)
  }
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

/** Короткий текст payload'а (demand/tip/mark), уже урезанный по `NOTE_MAX_CHARS`. */
function payloadText(payload: unknown): string {
  const o = asObject(payload)
  const raw = o && typeof o.text === 'string' ? o.text : null
  return raw ? raw.trim().slice(0, NOTE_MAX_CHARS) : ''
}

/** Грабёж: пират давит на груз/выкуп. Принуждать нечем (он и так враг) — метим угрозу в журнал. */
function demandCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const text = payloadText(payload)
  if (!text) return null
  recordEvent(world, ship, { kind: 'note', text: `ТРЕБОВАНИЕ: ${text}` })
  return { line: null }
}

/**
 * Бот САМ сдаётся. Пускаем ТОЛЬКО когда домен и так разрешает сдачу (тема `surrender`
 * разблокирована — щит сбит): иначе невредимого врага уболтали бы бросить бой даром.
 * Исполняет санкционированный `applyOutcome` (сменит фракцию на мирную, вытряхнет груз).
 */
function surrenderCommand(world: World, ship: ShipEntity, _payload: unknown): CommandOutcome | null {
  const line = linesFor(world, ship).find((l) => l.topic === 'surrender')
  if (!line || line.blocked !== null) return null
  applyOutcome(world, ship, 'surrender')
  recordEvent(world, ship, { kind: 'note', text: 'сдался' })
  return { line: 'Противник сдался.' }
}

/** Бот удирает: уходит в отрыв, гасит огонь и, при наличии привода, заряжает прыжок-побег. */
function fleeCommand(world: World, ship: ShipEntity, _payload: unknown): CommandOutcome | null {
  const ai = ship.ai
  if (!ai) return null
  ai.mode = 'evade'
  ai.targetId = null
  ai.wantsFire = false
  ai.wantsMissile = false
  // Заряд прыжка ставим лишь если он ещё не идёт и есть чем прыгать (иначе просто отрыв).
  if (ship.spec.jumpRange > 0 && ai.warpTimer < 0) ai.warpTimer = WARP.CHARGE
  recordEvent(world, ship, { kind: 'note', text: 'бежал из боя' })
  return { line: null }
}

/** Бот уходит из системы совсем — конец встречи. С приводом уходит прыжком, иначе в отрыв. */
function departCommand(world: World, ship: ShipEntity, _payload: unknown): CommandOutcome | null {
  const ai = ship.ai
  if (!ai) return null
  if (ship.spec.jumpRange > 0) beginWarpDeparture(world, ship)
  else ai.mode = 'evade'
  recordEvent(world, ship, { kind: 'note', text: 'ушёл' })
  return { line: null }
}

/** Знакомство: бот назвался — заводим запись в журнале (идемпотентно). Строку даём лишь на НОВОЕ. */
function meetCommand(world: World, ship: ShipEntity, _payload: unknown): CommandOutcome | null {
  const wasAcquainted = ship.acquaintanceId != null
  rememberPilot(world, ship)
  const newlyMet = !wasAcquainted && ship.acquaintanceId != null
  return { line: newlyMet ? `Знакомство: ${ship.name}.` : null }
}

/** Наводка/слух от бота — в журнал знакомого. Сам текст произносит реплика модели. */
function tipCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const text = payloadText(payload)
  if (!text) return null
  recordEvent(world, ship, { kind: 'note', text: `СОВЕТ: ${text}` })
  return { line: null }
}

/** Метка места — пока словом в журнал (реальные пины карты — отдельная задача). */
function markCommand(world: World, ship: ShipEntity, payload: unknown): CommandOutcome | null {
  const text = payloadText(payload)
  if (!text) return null
  recordEvent(world, ship, { kind: 'note', text: `МЕТКА: ${text}` })
  return { line: null }
}

// ─── Шина ────────────────────────────────────────────────────────────────────────

const HANDLERS: Record<string, CommandHandler> = {
  ask: askCommand,
  order: orderCommand,
  task: taskCommand,
  social: socialCommand,
  stance: stanceCommand,
  mapEdit: mapEditCommand,
  transfer: transferCommand,
  note: noteCommand,
  learn: learnCommand,
  plan: planCommand,
  demand: demandCommand,
  surrender: surrenderCommand,
  flee: fleeCommand,
  depart: departCommand,
  meet: meetCommand,
  tip: tipCommand,
  mark: markCommand,
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
