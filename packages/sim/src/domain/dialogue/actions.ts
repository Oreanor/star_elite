import type { Command } from './commandBus'
import type { Topic } from './dialogue'
import {
  coerceLearn,
  coerceOrder,
  coercePlanSteps,
  coerceStance,
  coerceTopic,
  coerceTransfer,
  sanitizeEscortTransfer,
} from './payload'

/**
 * ПУЛ ЭКШНОВ диалога и НАБОРЫ ПО РОЛЯМ.
 *
 * Раньше `parseModelReply` был лестницей `if`: поле за полем вручную превращались в команды.
 * Это ветвление вместо данных (нарушение OCP): новая способность — новая ветка в парсере, а
 * какие способности у кого — нигде явно не сказано. Теперь способность — ЗАПИСЬ в пуле: она
 * сама знает свой ключ в JSON модели, свои роли и как свернуться в команду шины. Парсер просто
 * идёт по пулу, отфильтрованному ролью собеседника. Добавить экшн = добавить запись сюда и,
 * если надо, обработчик в `commandBus`; править `parseModelReply` больше НЕ нужно.
 *
 * РОЛЬ — «кто говорит»: обычный бот и бог правят разными наборами. Роль открыта: появится
 * третья (диспетчер станции, торговец-квестодатель) — заведём набор, парсер и промпт подхватят.
 */

/** Роль собеседника. Открытый союз: новая роль = новый член + строки в наборах пула. */
export type DialogueRole = 'bot' | 'god'

/** Что парсеру известно помимо самого JSON — чтобы проверить поле, не веря модели. */
export interface ActionContext {
  /** Темы, которые СЕЙЧАС механически разрешены (незаблокированные `linesFor`). */
  readonly allowedTopics: readonly Topic[]
  /**
   * Гонорар за наём, если он сейчас обсуждается. Нужен ровно затем, чтобы отличить ЭХО платы
   * (модель повторила гонорар — его спишет сам наём) от осознанного платежа игрока той же
   * командой. `null`/нет — наём не при чём, любые деньги проводим как есть.
   */
  readonly escortFee?: number | null
}

/**
 * Одна способность: как достать её из плоского JSON модели и в какую команду свернуть.
 * `build` возвращает 0..n команд — пусто, если поля нет или оно не прошло проверку домена.
 */
export interface DialogueAction {
  /** Тег экшна — для документации и каталога промпта. Обычно совпадает с `action` команды. */
  readonly id: string
  /** Роли, которым экшн доступен. */
  readonly roles: readonly DialogueRole[]
  /** Плоский JSON модели → команды шины. */
  build(o: Record<string, unknown>, ctx: ActionContext): Command[]
}

// ─── Экшны пула ───────────────────────────────────────────────────────────────
// Ключ в JSON у экшна может НЕ совпадать с тегом команды (intent→ask, remember→note,
// command→order) — сопоставление инкапсулировано здесь, в `build`, и нигде больше.

/** Просьба-действие из каталога тем (`intent`) — только то, что сейчас разрешено. */
const askAction: DialogueAction = {
  id: 'ask',
  roles: ['bot'],
  build(o, ctx) {
    const intent = coerceTopic(o.intent)
    return intent && ctx.allowedTopics.includes(intent)
      ? [{ action: 'ask', payload: { topic: intent, llm: true } }]
      : []
  },
}

/** Тон реплики игрока: нахамил/польстил. Следствие для обиды считает домен. */
const socialAction: DialogueAction = {
  id: 'social',
  roles: ['bot', 'god'],
  build(o) {
    return o.social === 'insult' || o.social === 'flatter'
      ? [{ action: 'social', payload: { tone: o.social } }]
      : []
  },
}

/** Бот сам переменил отношение к командиру: оттаял или озлобился. Богу тоже — дарует милость. */
const stanceAction: DialogueAction = {
  id: 'stance',
  roles: ['bot', 'god'],
  build(o) {
    const stance = coerceStance(o.stance)
    return stance ? [{ action: 'stance', payload: { stance } }] : []
  },
}

/** Приказ послушания СВОЕМУ эскорту (`command`). Чужому не прикажешь — стережёт домен. */
const orderAction: DialogueAction = {
  id: 'order',
  roles: ['bot'],
  build(o) {
    const order = coerceOrder(o.command)
    if (!order) return []
    const target = typeof o.commandTarget === 'number' ? o.commandTarget : null
    return [{ action: 'order', payload: { order, target } }]
  },
}

/** Передача добра. Наём эскорта платит игра — трансфер за наём домен вычищает. */
const transferAction: DialogueAction = {
  id: 'transfer',
  roles: ['bot'],
  build(o, ctx) {
    const intent = coerceTopic(o.intent)
    const transfer = sanitizeEscortTransfer(coerceTransfer(o.transfer), intent, ctx.escortFee ?? null)
    return transfer ? [{ action: 'transfer', payload: transfer }] : []
  },
}

/** Запомнить произвольный факт («запомни, что…»). Доступно и богу — он помнит смертных. */
const noteAction: DialogueAction = {
  id: 'note',
  roles: ['bot', 'god'],
  build(o) {
    const raw = typeof o.remember === 'string' && o.remember.trim() ? o.remember.trim() : null
    return raw ? [{ action: 'note', payload: { text: raw } }] : []
  },
}

/** Мета переводчика: «их фраза → что делать». Тихо в журнал, для следующей встречи. */
const learnAction: DialogueAction = {
  id: 'learn',
  roles: ['bot'],
  build(o) {
    const learn = coerceLearn(o.learn)
    return learn ? [{ action: 'learn', payload: { text: learn } }] : []
  },
}

/**
 * Правка карты вселенной — только богу. Модель кладёт объект в поле `mapEdit`
 * ({op, index?, color?/name?/x,y,z?}); проверку и исполнение (дельта поверх сида) делает шина.
 */
const mapEditAction: DialogueAction = {
  id: 'mapEdit',
  roles: ['god'],
  build(o) {
    const edit = o.mapEdit
    return typeof edit === 'object' && edit !== null ? [{ action: 'mapEdit', payload: edit }] : []
  },
}

/** Макро-план: купить, вылететь, прикрывать — компилируется и исполняется доменом. */
const planAction: DialogueAction = {
  id: 'plan',
  roles: ['bot'],
  build(o) {
    const steps = coercePlanSteps(o.plan)
    return steps.length > 0 ? [{ action: 'plan', payload: { steps } }] : []
  },
}

/** Грабёж: пират ДАВИТ, требуя груз/выкуп. Механики принуждения нет (он и так враг) — запись угрозы. */
const demandAction: DialogueAction = {
  id: 'demand',
  roles: ['bot'],
  build(o) {
    const text = typeof o.demand === 'string' && o.demand.trim() ? o.demand.trim() : null
    return text ? [{ action: 'demand', payload: { text } }] : []
  },
}

/** Бот САМ сдаётся: перестаёт быть врагом. Домен пустит лишь проигрывающего (щит сбит) — без эксплойта. */
const surrenderAction: DialogueAction = {
  id: 'surrender',
  roles: ['bot'],
  build(o) {
    return o.surrender === true ? [{ action: 'surrender', payload: {} }] : []
  },
}

/** Бот удирает из боя (и прыжком, если есть привод). */
const fleeAction: DialogueAction = {
  id: 'flee',
  roles: ['bot'],
  build(o) {
    return o.flee === true ? [{ action: 'flee', payload: {} }] : []
  },
}

/** Бот уходит из системы совсем — конец встречи. */
const departAction: DialogueAction = {
  id: 'depart',
  roles: ['bot'],
  build(o) {
    return o.depart === true ? [{ action: 'depart', payload: {} }] : []
  },
}

/** Знакомство: бот называет себя и становится контактом в журнале (идемпотентно). */
const meetAction: DialogueAction = {
  id: 'meet',
  roles: ['bot'],
  build(o) {
    return o.meet === true ? [{ action: 'meet', payload: {} }] : []
  },
}

/** Наводка/слух — полезное словом, ложится в журнал знакомого. */
const tipAction: DialogueAction = {
  id: 'tip',
  roles: ['bot'],
  build(o) {
    const text = typeof o.tip === 'string' && o.tip.trim() ? o.tip.trim() : null
    return text ? [{ action: 'tip', payload: { text } }] : []
  },
}

/** Метка места для командира — словом в журнал (реальные пины карты — отдельная задача). */
const markAction: DialogueAction = {
  id: 'mark',
  roles: ['bot'],
  build(o) {
    const text = typeof o.mark === 'string' && o.mark.trim() ? o.mark.trim() : null
    return text ? [{ action: 'mark', payload: { text } }] : []
  },
}

// ─── Пул и наборы ───────────────────────────────────────────────────────────────

/**
 * Полный пул экшнов. Порядок ЗНАЧИМ: команды исполняются шиной в этом порядке за реплику
 * (сначала просьба-действие, затем тон/отношение, затем приказ/сделка, затем память/план).
 */
export const ACTIONS: readonly DialogueAction[] = [
  askAction,
  socialAction,
  stanceAction,
  mapEditAction,
  orderAction,
  transferAction,
  demandAction,
  surrenderAction,
  meetAction,
  tipAction,
  markAction,
  noteAction,
  learnAction,
  planAction,
  // Уход — В КОНЦЕ: любые прочие команды реплики исполнятся ДО того, как бот покинет сцену.
  fleeAction,
  departAction,
]

/** Набор экшнов роли — срез пула. Новая роль читается отсюда же, без правки парсера. */
export function actionsForRole(role: DialogueRole): DialogueAction[] {
  return ACTIONS.filter((a) => a.roles.includes(role))
}

/** Собрать команды из JSON модели по набору роли — сердце парсера вместо лестницы `if`. */
export function buildCommands(o: Record<string, unknown>, role: DialogueRole, ctx: ActionContext): Command[] {
  const commands: Command[] = []
  for (const action of actionsForRole(role)) commands.push(...action.build(o, ctx))
  return commands
}
