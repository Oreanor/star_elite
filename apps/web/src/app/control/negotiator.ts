import type { Disposition, Persona, Topic } from '@elite/sim'
import type { ChatTurn, NegotiationContext, NegotiatorReply } from '../../ui/dialogue/facts'

/**
 * Переговорщик: превращает СНИМОК МИРА и историю болтовни в реплику собеседника
 * через языковую модель. Живёт в app — это сетевой побочный эффект, домену он
 * заказан: тот обязан считаться на сервере без единого запроса наружу.
 *
 * Что делает модель: говорит в характере (персона + расклад сил + факты системы)
 * и, если игрок призвал к действию, ловит его в `intent`/`agree`. Само действие
 * применяет ДОМЕН (`applyOutcome`) — модель лишь решает «да/нет» словами, а мир
 * меняется детерминированно, ровно как по кнопке. Для будущей сети это и есть
 * граница: реплика — совет, команду исполняет домен.
 *
 * Надёжность важнее ума: список free-моделей от лучших к худшим, перебор по
 * очереди, а если всё молчит — локальный запас «плохая связь». Совсем без ключа
 * переговорщик выключен, и окно оставляет одни кнопки.
 */

const env = import.meta.env as unknown as Record<string, string | undefined>
const API_KEY = env.VITE_OPENROUTER_API_KEY?.trim() || ''
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const TIMEOUT_MS = 15_000

/** Free-модели OpenRouter, от лучших к худшим. Переопределяется VITE_OPENROUTER_MODELS. */
const DEFAULT_MODELS = [
  'deepseek/deepseek-chat-v3-0324:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'qwen/qwen-2.5-72b-instruct:free',
  'mistralai/mistral-small-3.2-24b-instruct:free',
  'meta-llama/llama-3.1-8b-instruct:free',
]

const MODELS = (env.VITE_OPENROUTER_MODELS?.split(',').map((s) => s.trim()).filter(Boolean) ?? []).length
  ? env.VITE_OPENROUTER_MODELS!.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_MODELS

/** Есть ли чем говорить. Нет ключа — окно покажет только кнопки. */
export function negotiatorAvailable(): boolean {
  return API_KEY.length > 0
}

// ─── Персона в слова ──────────────────────────────────────────────────────────

const DISPOSITION_RU: Record<Disposition, string> = {
  brave: 'дерзкий, стоит до последнего',
  cowardly: 'трусоватый, ломается рано',
  greedy: 'жадный до добычи',
  honorable: 'честный, держит слово',
  hotheaded: 'вспыльчивый, заводится с полуслова',
  calculating: 'расчётливый, взвешивает шансы',
}

const level = (n: number): string => (n <= 2 ? 'низкий' : n >= 4 ? 'высокий' : 'средний')

/** Расклад по одной черте глазами собеседника: противник (игрок) против него. */
function edge(mine: number, foe: number, more: string, less: string): string {
  const d = foe - mine
  if (d >= 2) return `противник заметно ${more}`
  if (d >= 1) return `противник немного ${more}`
  if (d <= -2) return `противник заметно ${less}`
  if (d <= -1) return `противник немного ${less}`
  return 'вы вровень'
}

function personaLines(p: Persona): string {
  return [
    `нрав: ${DISPOSITION_RU[p.disposition]}`,
    `ум ${p.intellect}/5 (${level(p.intellect)})`,
    `темперамент ${p.temperament}/5 (${level(p.temperament)})`,
    `харизма ${p.charisma}/5 (${level(p.charisma)})`,
    `воля ${p.willpower}/5 (${level(p.willpower)})`,
  ].join(', ')
}

const INTENT_RU: Record<Topic, string> = {
  surrender: 'surrender — сдаться: прекратить бой, сбросить груз, перестать быть врагом',
  mercy: 'mercy — пощадить игрока и отпустить его (ты пират, добыча — его груз)',
  escort: 'escort — наняться к нему в сопровождение за плату',
  plunder: 'plunder — подчиниться грабежу: отдать весь груз и оружие',
  greet: 'greet — просто болтовня, приветствие, ни к чему не обязывает',
}

// ─── Промпт ────────────────────────────────────────────────────────────────────

function systemPrompt(ctx: NegotiationContext): string {
  const w = ctx.world
  const t = ctx.them
  const y = ctx.you

  const standoff = [
    edge(t.persona.intellect, y.persona.intellect, 'умнее тебя', 'глупее тебя'),
    edge(t.persona.willpower, y.persona.willpower, 'волевее тебя', 'слабее духом'),
    edge(t.persona.charisma, y.persona.charisma, 'убедительнее тебя', 'менее убедителен'),
  ].join('; ')

  const intents = ctx.allowedIntents.length
    ? ctx.allowedIntents.map((i) => `• ${INTENT_RU[i]}`).join('\n')
    : '• (сейчас ничего механического от тебя не добьёшься — только разговор)'

  return [
    `Ты — пилот по имени ${t.name}, летишь на корабле «${t.ship}». Роль: ${t.role}.`,
    `Твой характер — ${personaLines(t.persona)}.`,
    `Твоё состояние: корпус ${t.hullPct}%, щит ${t.shieldPct}%. В трюме: ${t.cargo}.`,
    '',
    `Перед тобой командир на «${y.ship}» в ${ctx.distanceM} м. Твои сенсоры видят: корпус ${y.hullPct}%, щит ${y.shieldPct}%, в трюме: ${y.cargo}. Он ${ctx.yourHeading}.`,
    `Его характер — ${personaLines(y.persona)}.`,
    `Расклад: ${standoff}.`,
    ctx.metBefore ? 'Вы уже пересекались раньше.' : 'Вы видите друг друга впервые.',
    '',
    `ГДЕ ВЫ: система ${w.systemName}, строй — ${w.government}, экономика — ${w.economy}, тех-уровень ${w.techLevel}, население — ${w.species}.`,
    `В системе планет: ${w.planets}, лун: ${w.moons}, станций: ${w.stations}. Известные тела: ${w.bodyNames.join(', ') || '—'}.`,
    `Обстановка: ${w.danger}.`,
    '',
    'ЧЕМУ ВЕРИТЬ — КОГДА РЕШАЕШЬ СУДЬБУ (сдаться, пойти в эскорт, отдать груз):',
    '— Факты выше (его корпус, щит, груз, где вы, обстановка) ты ВИДИШЬ сенсорами и знаешь наверняка.',
    '— То, что он ГОВОРИТ в эфире, — лишь слова: он может блефовать, набивать цену, пугать. РЕШЕНИЕ, меняющее игру, взвешивай по фактам и числам, а не по его россказням.',
    '— Сверяй сказанное с тем, что видишь. Заявил «щит на нуле» — глянь: по сенсорам так и есть, значит довод весомый; врёт — лови на вранье. Чем ты умнее, тем вернее распознаёшь блеф.',
    '— А вот в пустой болтовне (кто куда летит, байки, даже про принцессу) можешь и подыграть — это ни к чему не обязывает. Скепсис включай, лишь когда на кону игровое действие.',
    '',
    'КАК ОТВЕЧАТЬ:',
    '— Говори коротко, как по радиосвязи, на языке собеседника (по умолчанию русский). Оставайся в характере.',
    '— ОКРАШИВАЙ саму речь под свой нрав, ум и темперамент: тупой говорит просто и коряво, умный — складно и с подтекстом; вспыльчивый рубит и грубит, спокойный цедит ровно; трус лебезит и торгуется, дерзкий дерзит. Пусть по манере было слышно, кто ты.',
    '— Трепаться можно о чём угодно: погода, слухи, куда летишь. Опирайся на проверяемые факты, сам мир не выдумывай.',
    '— Соглашаться на действие уступай тем охотнее, чем сильнее противник превосходит тебя умом, волей и харизмой, — а не только когда твой корабль избит.',
    '— Если у тебя высокий темперамент, ты можешь вспылить и оборвать связь (hangup).',
    '— Клади трубку (hangup=true), когда договорено, тебе надоело или ты психанул.',
    '',
    'Действия, которые он может у тебя просить прямо сейчас:',
    intents,
    '',
    'Ответь СТРОГО одним JSON-объектом и ничем больше:',
    '{"reply": "твоя реплика", "intent": один из [' +
      ctx.allowedIntents.map((i) => `"${i}"`).join(', ') +
      '] или null, "agree": true|false, "hangup": true|false}',
    'intent — только если он ИМЕННО СЕЙЧАС призвал к этому действию; иначе null. agree важно лишь при непустом intent.',
  ].join('\n')
}

// ─── Разбор ответа ──────────────────────────────────────────────────────────────

/** Вытащить JSON из ответа модели, даже если она обернула его в текст или ```. */
function extractJson(raw: string): unknown {
  const fenced = raw.replace(/```json/gi, '').replace(/```/g, '')
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(fenced.slice(start, end + 1))
  } catch {
    return null
  }
}

function coerceReply(parsed: unknown, allowed: Topic[]): NegotiatorReply | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  const text = typeof o.reply === 'string' ? o.reply.trim() : ''
  if (!text) return null

  const rawIntent = typeof o.intent === 'string' ? (o.intent as Topic) : null
  // Модель могла назвать действие, которого сейчас нельзя, — не верим на слово.
  const intent = rawIntent && allowed.includes(rawIntent) ? rawIntent : null
  return {
    text,
    intent,
    agree: intent !== null && o.agree === true,
    hangup: o.hangup === true,
    source: 'model',
  }
}

// ─── Обрыв связи ─────────────────────────────────────────────────────────────────

const STATIC_LINES = [
  '…кхх… связь рвётся, повтори.',
  '…рх… тебя не разобрать, одни помехи.',
  '…канал сыпется… треск… скажи ещё раз.',
]

/** Запасная реплика, когда все модели молчат. Мир не меняем, трубку не кладём. */
function staticNoise(history: ChatTurn[]): NegotiatorReply {
  return {
    text: STATIC_LINES[history.length % STATIC_LINES.length]!,
    intent: null,
    agree: false,
    hangup: false,
    source: 'fallback',
  }
}

// ─── Запрос ──────────────────────────────────────────────────────────────────────

function toMessages(ctx: NegotiationContext, history: ChatTurn[], userText: string) {
  const msgs: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt(ctx) },
  ]
  // Только последние реплики: канал короткий, а лишний контекст free-модель не тянет.
  for (const turn of history.slice(-10)) {
    if (turn.who === 'you') msgs.push({ role: 'user', content: turn.text })
    else if (turn.who === 'them') msgs.push({ role: 'assistant', content: turn.text })
  }
  msgs.push({ role: 'user', content: userText })
  return msgs
}

async function callModel(
  model: string,
  messages: ReturnType<typeof toMessages>,
): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'Star Elite',
      },
      body: JSON.stringify({ model, messages, temperature: 0.85, max_tokens: 300 }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Добыть реплику собеседника. Перебирает модели по очереди: первая, что ответила
 * разборным JSON, — победила. Все молчат — «плохая связь». Без ключа сюда не зовут,
 * но и на этот случай отдаём шум, а не падаем.
 */
export async function negotiate(
  ctx: NegotiationContext,
  history: ChatTurn[],
  userText: string,
): Promise<NegotiatorReply> {
  if (!negotiatorAvailable()) return staticNoise(history)

  const messages = toMessages(ctx, history, userText)
  for (const model of MODELS) {
    const raw = await callModel(model, messages)
    if (raw === null) continue
    const reply = coerceReply(extractJson(raw), ctx.allowedIntents)
    if (reply) return reply
  }
  return staticNoise(history)
}
