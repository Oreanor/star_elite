import { commodityBuyPrice, commoditySellPrice, commodityStock, dispatcherBriefing, extractModelJson, localFine, localSettlement, parseModelReply, stationInterlocutor, type DialogueRole, type Persona, type Topic, type World } from '@elite/sim'
import type { ChatTurn, ContextDigest, NegotiationContext, NegotiatorReply } from '../../ui/dialogue/facts'
import { currentLang } from '../../ui/i18n/i18n'
import { negotiatorLocale } from './negotiatorLocale'

/**
 * Переговорщик: превращает СНИМОК МИРА и историю болтовни в реплику собеседника
 * через языковую модель. Промпт и ответ — на языке интерфейса (`currentLang`).
 */

const env = import.meta.env as unknown as Record<string, string | undefined>
const TIMEOUT_MS = 9_000

const GROQ_KEY = env.VITE_GROQ_API_KEY?.trim() || ''
const OPENROUTER_KEY = env.VITE_OPENROUTER_API_KEY?.trim() || ''
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Порядок — это пары гонки (`RACE_WIDTH`): первыми спрашиваются лучшие. Сверено с живыми
 * списками сервисов и прогоном на промпте переговорщика 2026-10-09: держат роль, формат и
 * русский. Списки сервисов меняются без предупреждения — снятая модель выбывает сама.
 */
const GROQ_DEFAULT_MODELS = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
]

const DEFAULT_MODELS = [
  'apodex/apodex-1.1-mini:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'dots-studio/dots-3-note-preview:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
]

function envModels(key: string, fallback: string[]): string[] {
  const list = env[key]?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
  return list.length ? list : fallback
}
const OPENROUTER_MODELS = envModels('VITE_OPENROUTER_MODELS', DEFAULT_MODELS)
const GROQ_MODELS = envModels('VITE_GROQ_MODELS', GROQ_DEFAULT_MODELS)

interface ModelRef {
  label: string
  endpoint: string
  key: string
  model: string
}

function tierOf(endpoint: string, key: string, models: string[], tag: string): ModelRef[] {
  return key ? models.map((model) => ({ label: `${tag}/${model}`, endpoint, key, model })) : []
}

const TIERS: ModelRef[][] = [
  tierOf(GROQ_ENDPOINT, GROQ_KEY, GROQ_MODELS, 'groq'),
  tierOf(OPENROUTER_ENDPOINT, OPENROUTER_KEY, OPENROUTER_MODELS, 'or'),
].filter((tier) => tier.length > 0)

/**
 * Здоровье моделей на сеанс. Снятую или неизвестную сервису модель (400/404) спрашивать
 * больше незачем — она выбывает до перезагрузки. Упёршуюся в лимит (429) не дёргаем минуту:
 * бесплатный ключ иначе выжигается повторами в пустоту.
 */
const deadModels = new Set<string>()
const restingUntil = new Map<string, number>()
const REST_MS = 60_000
/** Сколько моделей уровня спрашивать разом: гонка всем списком жгла лимит в разы быстрее. */
const RACE_WIDTH = 2

function liveModels(tier: ModelRef[], now: number): ModelRef[] {
  return tier.filter((ref) => !deadModels.has(ref.label) && (restingUntil.get(ref.label) ?? 0) <= now)
}

export function negotiatorAvailable(): boolean {
  return TIERS.length > 0
}

/** Порог «канал трещит» — подсказка модели попрощаться. Выше HARD — обрыв без запроса. */
export const PROMPT_SOFT_CHARS = 9_500
export const PROMPT_HARD_CHARS = 12_000

const CHAT_RECENT = 6

function locale() {
  return negotiatorLocale(currentLang())
}

function chatRecap(turns: ChatTurn[]): string {
  if (turns.length <= CHAT_RECENT) return ''
  const old = turns.slice(0, -CHAT_RECENT).filter((t) => t.who !== 'system')
  if (!old.length) return ''
  const en = currentLang() === 'en'
  const snippet = old.slice(-8).map((t) => {
    const tag = t.who === 'you' ? (en ? 'them' : 'он') : en ? 'you' : 'ты'
    const text = t.text.length > 36 ? `${t.text.slice(0, 33)}…` : t.text
    return `${tag}: «${text}»`
  })
  return en
    ? `EARLIER IN THIS COMMS (compressed):\n${snippet.join(' · ')}`
    : `РАНЬШЕ В ЭТОМ РАЗГОВОРЕ (сжато):\n${snippet.join(' · ')}`
}

function buildMessages(ctx: NegotiationContext, history: ChatTurn[], userText: string) {
  const L = locale()
  const recap = chatRecap(history)
  let system = L.systemPrompt(ctx)
  if (recap) system += `\n\n${recap}`
  const recent = history.slice(-CHAT_RECENT)
  let chars = system.length + userText.length + L.attitudeStamp(ctx).length
  for (const turn of recent) chars += turn.text.length

  if (chars >= PROMPT_SOFT_CHARS) system += `\n\n${L.channelPressureHint()}`

  const msgs: { role: 'system' | 'user' | 'assistant'; content: string }[] = [{ role: 'system', content: system }]
  for (const turn of recent) {
    if (turn.who === 'you') msgs.push({ role: 'user', content: turn.text })
    else if (turn.who === 'them') msgs.push({ role: 'assistant', content: turn.text })
  }
  msgs.push({ role: 'user', content: `${L.attitudeStamp(ctx)}\n${userText}` })
  if (chars >= PROMPT_SOFT_CHARS) chars += L.channelPressureHint().length

  return { messages: msgs, chars }
}

function staticNoise(history: ChatTurn[]): NegotiatorReply {
  const lines = locale().staticNoise
  return { text: lines[history.length % lines.length]!, commands: [], hangup: false, source: 'fallback' }
}

function channelOverloadGoodbye(ctx: NegotiationContext): NegotiatorReply {
  return { text: locale().overloadGoodbye(ctx), commands: [], hangup: true, source: 'overload' }
}

export function stallLine(digest: ContextDigest, persona: Persona): string {
  return locale().stallLine(digest, persona)
}

function toReply(parsed: ReturnType<typeof parseModelReply>): NegotiatorReply | null {
  if (!parsed) return null
  return { ...parsed, source: 'model' }
}

type OutboundMessages = ReturnType<typeof buildMessages>['messages']

/**
 * Сколько токенов дать ответу. Сам JSON реплики со всеми полями — около двухсот, а модели с
 * рассуждением (gpt-oss, Nemotron) тратят лимит ещё и на скрытую мысль: при прежних 300 они
 * упирались в потолок и отдавали ПУСТОЙ ответ — бот отвечал «шумом связи».
 */
const MAX_TOKENS = 900

/**
 * Рассуждать коротко: болтовне в эфире глубокая мысль не нужна, а каждый её токен — задержка
 * и риск упереться в лимит. Параметр у сервисов свой: Groq — `reasoning_effort` по семейству
 * (у Qwen рассуждение выключается совсем), OpenRouter — единое поле `reasoning`.
 */
function reasoningParams(ref: ModelRef): Record<string, unknown> {
  if (ref.endpoint === OPENROUTER_ENDPOINT) return { reasoning: { effort: 'low', exclude: true } }
  if (ref.model.startsWith('openai/gpt-oss')) return { reasoning_effort: 'low' }
  if (ref.model.startsWith('qwen/')) return { reasoning_effort: 'none' }
  return {}
}

async function callModel(ref: ModelRef, messages: OutboundMessages): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ref.endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${ref.key}`,
        'Content-Type': 'application/json',
        'X-Title': 'Star Elite',
      },
      body: JSON.stringify({ model: ref.model, messages, temperature: 0.72, max_tokens: MAX_TOKENS, ...reasoningParams(ref) }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.warn(`[negotiator] ${ref.label} → HTTP ${res.status}: ${body.slice(0, 200)}`)
      if (res.status === 400 || res.status === 404) {
        // Снята или не существует — повтор не поможет. 400 бывает и от кривого запроса,
        // поэтому выбывает только при явном отказе в модели.
        if (res.status === 404 || /model_(decommissioned|not_found)|does not exist/i.test(body)) deadModels.add(ref.label)
      } else if (res.status === 429) {
        restingUntil.set(ref.label, Date.now() + REST_MS)
      }
      return null
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = data.choices?.[0]?.message?.content ?? null
    if (!content) console.warn(`[negotiator] ${ref.label} → пустой ответ`)
    return content
  } catch (err) {
    console.warn(`[negotiator] ${ref.label} → сбой запроса:`, err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

const RETRY_BACKOFF_MS = 700
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function raceAll(
  refs: ModelRef[],
  messages: OutboundMessages,
  allowed: Topic[],
  role: DialogueRole,
  escortFee: number | null,
  fineAmount: number | null,
): Promise<NegotiatorReply | null> {
  return new Promise((resolve) => {
    let pending = refs.length
    let done = false
    for (const ref of refs) {
      void callModel(ref, messages).then((raw) => {
        if (done) return
        const reply = raw ? toReply(parseModelReply(extractModelJson(raw), allowed, role, escortFee, fineAmount)) : null
        if (reply) {
          done = true
          resolve(reply)
          return
        }
        if (--pending === 0) resolve(null)
      })
    }
  })
}

export async function negotiate(
  ctx: NegotiationContext,
  history: ChatTurn[],
  userText: string,
): Promise<NegotiatorReply> {
  if (!negotiatorAvailable()) return staticNoise(history)

  const { messages, chars } = buildMessages(ctx, history, userText)
  if (chars >= PROMPT_HARD_CHARS) return channelOverloadGoodbye(ctx)

  // Роль решает НАБОР экшнов и промпт: бог правит вселенную, смертный — торгуется и воюет.
  const role: DialogueRole = ctx.divine ? 'god' : 'bot'

  for (let attempt = 0; attempt < 2; attempt++) {
    for (const tier of TIERS) {
      // Пары живых моделей по очереди: ответила первая пара — остальных не трогаем.
      const live = liveModels(tier, Date.now())
      for (let i = 0; i < live.length; i += RACE_WIDTH) {
        const batch = live.slice(i, i + RACE_WIDTH)
        const reply = await raceAll(batch, messages, ctx.allowedIntents, role, ctx.economy.escortFee ?? null, ctx.localFineAmount)
        if (reply) {
          if (reply.hangup && chars >= PROMPT_SOFT_CHARS) return { ...reply, source: 'overload' }
          return reply
        }
      }
    }
    if (attempt === 0) await delay(RETRY_BACKOFF_MS)
  }
  return staticNoise(history)
}

/** Свободный чат с диспетчером станции. Это отдельная роль: он знает округу,
 * но не притворяется пилотом и не получает торговые/боевые команды. */
export async function negotiateDispatcher(world: World, history: ChatTurn[], userText: string): Promise<NegotiatorReply> {
  const station = stationInterlocutor(world)
  if (!station || !negotiatorAvailable()) return staticNoise(history)
  const brief = dispatcherBriefing(world)
  const english = currentLang() === 'en'
  const bodies = brief.bodies
    .map((body) => `${body.name} (${body.kind}, ${body.distanceKm} km, ${body.populated ? 'inhabited' : 'uninhabited'}${body.hasStation ? ', station' : ''})`)
    .join('; ')
  const fine = localFine(world)?.amount ?? null
  const system = english
    ? `You are the station dispatcher at ${station.name}. Speak as a concise in-world radio operator. You know this station and the entire current system. Government: ${brief.settlement.government}; economy: ${brief.settlement.economy}; tech level: ${brief.settlement.techLevel}; dock occupant: ${brief.dockOccupant ?? 'none'}; bodies: ${bodies || 'none'}. Answer the pilot's questions directly. Do not invent missions, prices, or facts absent from this briefing. If details are missing, request lookup: market, worlds, history, or guide. The commander owes this local authority ${fine == null ? 'nothing' : `${fine} credits`}. On first contact, remind him. If he asks to pay, quote the amount first; set fine confirm:false, and only set fine confirm:true after explicit consent. Reply with one JSON object: {"reply":"...","emotion":"neutral"|"joy"|"pain"|"anger"|"fear"|"sadness"|null,"fine":{"confirm":true|false}|null,"lookup":"market"|"worlds"|"history"|"guide"|null,"hangup":true|false}.`
    : `Ты диспетчер станции ${station.name}. Говори коротко, как живой оператор связи, и отвечай прямо на вопросы пилота. Ты знаешь эту станцию и всю текущую систему. Строй: ${brief.settlement.government}; экономика: ${brief.settlement.economy}; техуровень: ${brief.settlement.techLevel}; у причала: ${brief.dockOccupant ?? 'никого'}; тела системы: ${bodies || 'нет'}. Не выдумывай миссии, цены и факты, которых нет в этой сводке. Если не хватает деталей, запроси lookup: market, worlds, history или guide. Командир должен местной власти ${fine == null ? 'ничего' : `${fine} кредитов`}. При первой связи напомни об этом. Если он просит заплатить, сначала назови сумму и поставь fine confirm:false; fine confirm:true ставь только после явного согласия. Ответь одним JSON: {"reply":"…","emotion":"neutral"|"joy"|"pain"|"anger"|"fear"|"sadness"|null,"fine":{"confirm":true|false}|null,"lookup":"market"|"worlds"|"history"|"guide"|null,"hangup":true|false}.`
  const messages: OutboundMessages = [{ role: 'system', content: system }]
  for (const turn of history.slice(-CHAT_RECENT)) {
    if (turn.who === 'you') messages.push({ role: 'user', content: turn.text })
    else if (turn.who === 'them') messages.push({ role: 'assistant', content: turn.text })
  }
  messages.push({ role: 'user', content: userText })
  const request = async (input: OutboundMessages): Promise<NegotiatorReply | null> => {
    for (const tier of TIERS) {
      const reply = await raceAll(liveModels(tier, Date.now()), input, [], 'bot', null, fine)
      if (reply) return reply
    }
    return null
  }
  const first = await request(messages)
  if (!first) return staticNoise(history)
  if (!first.lookup) return first

  const lookup = dispatcherLookup(world, first.lookup, english)
  const followUp: OutboundMessages = [...messages, { role: 'assistant', content: first.text }, {
    role: 'user',
    content: english
      ? `SYSTEM LOOKUP (${first.lookup}):\n${lookup}\nNow answer the pilot's last question using this data. Do not request another lookup; set lookup:null.`
      : `СИСТЕМНЫЙ LOOKUP (${first.lookup}):\n${lookup}\nТеперь ответь на последний вопрос пилота по этим данным. Новый lookup не запрашивай; поставь lookup:null.`,
  }]
  return (await request(followUp)) ?? first
}

function dispatcherLookup(world: World, kind: NonNullable<NegotiatorReply['lookup']>, english: boolean): string {
  if (kind === 'market') {
    const settlement = localSettlement(world)
    return commodityStock()
      .slice(0, 12)
      .map((c) => `${c.name}: buy ${commodityBuyPrice(world, c)}, sell ${commoditySellPrice(world, c)}`)
      .join('; ') + ` (tech ${settlement.techLevel}, ${settlement.economy})`
  }
  if (kind === 'worlds') {
    return world.bodies
      .filter((b) => b.kind !== 'star')
      .map((b) => `${b.name}: ${b.kind}, population ${b.population}, radius ${Math.round(b.radius / 1000)} km`)
      .join('; ')
  }
  if (kind === 'history') return english ? 'The dispatcher has no personal history with the commander.' : 'У диспетчера пока нет личной истории с командиром.'
  return english
    ? 'Station operations: trade and fitting are available while docked; navigation and system information are available by radio.'
    : 'Правила станции: торговля и оснащение доступны в доке; навигационные сведения и данные системы можно запросить по связи.'
}
