import { copilotBriefing, findModule, commodityBuyPrice, commoditySellPrice, commodityStock, dispatcherBriefing, dispatcherTraffic, extractModelJson, localFine, localSettlement, parseModelReply, stationInterlocutor, type DialogueRole, type Persona, type TrafficShip, type Topic, type World } from '@elite/sim'
import type { ChatTurn, ContextDigest, CopilotReply, NegotiationContext, NegotiatorReply } from '../../ui/dialogue/facts'
import { currentLang } from '../../ui/i18n/i18n'
import { chassisName, moduleName, occupationName, properName } from '../../ui/i18n/dataNames'
import { negotiatorLocale } from './negotiatorLocale'
import { chatMessages } from './chatMessages'

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
  const old = turns.slice(0, -CHAT_RECENT)
  if (!old.length) return ''
  const en = currentLang() === 'en'
  const snippet = old.slice(-8).map((t) => {
    const tag = t.who === 'system' ? factTag() : t.who === 'you' ? (en ? 'them' : 'он') : en ? 'you' : 'ты'
    const text = t.text.length > 36 ? `${t.text.slice(0, 33)}…` : t.text
    return `${tag}: «${text}»`
  })
  return en
    ? `EARLIER IN THIS COMMS (compressed):\n${snippet.join(' · ')}`
    : `РАНЬШЕ В ЭТОМ РАЗГОВОРЕ (сжато):\n${snippet.join(' · ')}`
}

/** Пометка исхода из канала («· Зачислено: 100 кр ·»): что ПРОИЗОШЛО, а не что сказано. */
function factTag(): string {
  return currentLang() === 'en' ? 'COMMS FACT' : 'ФАКТ КАНАЛА'
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

  const msgs = [
    { role: 'system' as const, content: system },
    ...chatMessages(recent, `${L.attitudeStamp(ctx)}\n${userText}`, factTag()),
  ]
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
    ? `You are the station dispatcher at ${station.name}. Speak as a concise in-world radio operator. You know this station and the entire current system. Government: ${brief.settlement.government}; economy: ${brief.settlement.economy}; tech level: ${brief.settlement.techLevel}; dock occupant: ${brief.dockOccupant ?? 'none'}; bodies: ${bodies || 'none'}. Answer the pilot's questions directly. Do not invent missions, prices, or facts absent from this briefing. If details are missing, request lookup: market, worlds, history, guide, or traffic. Ships in the system (who is flying where, who is docked) — ALWAYS request lookup "traffic", every time you are asked: traffic changes constantly, never answer from memory. The commander owes this local authority ${fine == null ? 'nothing' : `${fine} credits`}. On first contact, remind him. If he asks to pay, quote the amount first; set fine confirm:false, and only set fine confirm:true after explicit consent. Reply with one JSON object: {"reply":"...","emotion":"neutral"|"joy"|"pain"|"anger"|"fear"|"sadness"|null,"fine":{"confirm":true|false}|null,"lookup":"market"|"worlds"|"history"|"guide"|"traffic"|null,"hangup":true|false}.`
    : `Ты диспетчер станции ${station.name}. Говори коротко, как живой оператор связи, и отвечай прямо на вопросы пилота. Ты знаешь эту станцию и всю текущую систему. Строй: ${brief.settlement.government}; экономика: ${brief.settlement.economy}; техуровень: ${brief.settlement.techLevel}; у причала: ${brief.dockOccupant ?? 'никого'}; тела системы: ${bodies || 'нет'}. Не выдумывай миссии, цены и факты, которых нет в этой сводке. Если не хватает деталей, запроси lookup: market, worlds, history, guide или traffic. Про корабли в системе (кто где летает, кто у причала) — ВСЕГДА запрашивай lookup "traffic", каждый раз, когда спрашивают: трафик меняется постоянно, по памяти не отвечай. Командир должен местной власти ${fine == null ? 'ничего' : `${fine} кредитов`}. При первой связи напомни об этом. Если он просит заплатить, сначала назови сумму и поставь fine confirm:false; fine confirm:true ставь только после явного согласия. Ответь одним JSON: {"reply":"…","emotion":"neutral"|"joy"|"pain"|"anger"|"fear"|"sadness"|null,"fine":{"confirm":true|false}|null,"lookup":"market"|"worlds"|"history"|"guide"|"traffic"|null,"hangup":true|false}.`
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
  if (kind === 'traffic') {
    const where: Record<TrafficShip['status'], string> = english
      ? { berthed: 'docked at the station', inbound: 'on approach to dock', flying: 'in flight' }
      : { berthed: 'у причала', inbound: 'заходит на причал', flying: 'в полёте' }
    const stance: Record<TrafficShip['stance'], string> = english
      ? { hostile: 'hostile to the commander', friendly: 'friendly', neutral: 'neutral' }
      : { hostile: 'враг командиру', friendly: 'друг', neutral: 'нейтрал' }
    const ships = dispatcherTraffic(world)
    if (ships.length === 0) return english ? 'No ships in the system right now.' : 'Сейчас в системе ни одного борта.'
    return ships
      .map((s) => {
        const near = s.near ? (english ? `near ${properName(s.near)}` : `у ${properName(s.near)}`) : ''
        return `${s.pilot} («${chassisName(s.chassis)}», ${occupationName(s.originKind, s.faction)}, ${stance[s.stance]}, ${where[s.status]}${s.status === 'flying' && near ? ` ${near}` : ''}, ${s.distanceKm} km)`
      })
      .join('; ')
  }
  if (kind === 'history') return english ? 'The dispatcher has no personal history with the commander.' : 'У диспетчера пока нет личной истории с командиром.'
  return english
    ? 'Station operations: trade and fitting are available while docked; navigation and system information are available by radio.'
    : 'Правила станции: торговля и оснащение доступны в доке; навигационные сведения и данные системы можно запросить по связи.'
}


/** Сводка второго пилота словами для промпта: id у каждой цели — по ним он и выбирает. */
function copilotSituation(world: World, english: boolean, helmFlyTo: boolean): string {
  const b = copilotBriefing(world)
  if (!b) return ''
  const km = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`)
  const bodies = b.bodies
    .map((x) => `#${x.id} ${properName(x.name)} (${x.kind}${x.populated ? (english ? ', inhabited' : ', обитаема') : ''}, ${km(x.distanceM)})`)
    .join('; ')
  const contacts = b.contacts
    .map((c) => {
      const who = c.foe ? (english ? 'HOSTILE' : 'ВРАГ') : occupationName(c.occupation, c.faction)
      const scan = c.scanner ? (english ? ', on scanner' : ', на локаторе') : ''
      return `#${c.id} ${properName(c.name)} «${chassisName(c.chassis)}» (${who}, ${english ? 'rank' : 'ранг'} ${c.rank}, ${km(c.distanceM)}${scan})`
    })
    .join('; ')
  const broken = b.broken
    .map((m) => {
      const mod = findModule(m.moduleId)
      return `${m.n}) ${mod ? moduleName(mod) : m.moduleId} — ${english ? 'broken' : 'сломано'} ${m.faultPct}%, ${m.price} cr`
    })
    .join('; ')
  const helm = helmFlyTo ? 'cruise' : b.helm
  const none = english ? 'none' : 'нет'
  return english
    ? [
        `YOU: ${properName(b.name)}, rank ${b.rank} (1 ace … 10 rookie), pay ${b.salary} cr/month. Commander rank ${b.playerRank}.`,
        `HELM NOW: ${helm}${b.docked ? ' (docked at station)' : ''}.`,
        `BODIES (nearest first): ${bodies || none}.`,
        `SHIPS IN THE SYSTEM (nearest first; "on scanner" = within 20 km): ${contacts || 'no ships in the system'}. Canisters on scanner: ${b.pods}. The scanner WORKS — an empty list only means nobody is around.`,
        `SHIP: hull ${Math.round(b.hull.share * 100)}%${b.hull.repairPrice ? `, your hull repair ${b.hull.repairPrice} cr` : ''}. Broken parts: ${broken || none}.`,
      ].join('\n')
    : [
        `ТЫ: ${properName(b.name)}, ранг ${b.rank} (1 — ас … 10 — новичок), жалованье ${b.salary} кр/мес. Ранг командира ${b.playerRank}.`,
        `ШТУРВАЛ СЕЙЧАС: ${helm}${b.docked ? ' (стоим у причала)' : ''}.`,
        `ТЕЛА (ближние первыми): ${bodies || none}.`,
        `БОРТА В СИСТЕМЕ (ближние первыми; «на локаторе» — ближе 20 км): ${contacts || 'в системе ни одного борта'}. Контейнеров на локаторе: ${b.pods}. Локатор ИСПРАВЕН — пустой список значит лишь, что рядом никого.`,
        `КОРАБЛЬ: корпус ${Math.round(b.hull.share * 100)}%${b.hull.repairPrice ? `, твой ремонт корпуса ${b.hull.repairPrice} кр` : ''}. Сломано: ${broken || none}.`,
      ].join('\n')
}

const COPILOT_SCHEMA =
  '{"reply":"…","emotion":"neutral"|"joy"|"pain"|"anger"|"fear"|"sadness"|null,"goto":<body id>|null,"approach":<ship id>|null,"attack":"nearest"|"all"|<ship id>|null,"flee":true|null,"collect":true|null,"stop":true|null,"repair":"hull"|"all"|<part number>|null,"dismiss":true|null,"lookup":"market"|"traffic"|"worlds"|null,"clarify":true|false}'

/**
 * Свободный чат со ВТОРЫМ ПИЛОТОМ. Это роль `copilot`: приказы из речи игрока модель кладёт
 * в поля JSON, команды собирает тот же пул экшнов, исполняет домен (`crew/copilot.ts`).
 * Цены и трафик он «узнаёт у диспетчера» — тем же справочником, что диспетчер, второй репликой.
 */
export async function negotiateCopilot(world: World, history: ChatTurn[], userText: string, helmFlyTo: boolean): Promise<CopilotReply> {
  const copilot = world.copilot
  const noise = (): CopilotReply => ({ replies: [staticNoise(history).text], commands: [], emotion: null, source: 'fallback' })
  if (!copilot || !negotiatorAvailable()) return noise()
  const english = currentLang() === 'en'
  const persona = copilot.persona
  const situation = copilotSituation(world, english, helmFlyTo)
  const system = english
    ? `You are ${properName(copilot.name)}, the commander's CO-PILOT, sitting in his cockpit. Temper: ${persona.disposition}. Talk like a crewmate on intercom: short, alive, in character. Answer in English.
${situation}
You fly, fight, repair and know what a dispatcher knows. Turn the commander's words into orders in the JSON fields:
- "fly to the nearest station / planet X / the star" → goto: id from BODIES (nearest = smallest distance of that kind).
- "fly to that trader / find a trader and go to him" → approach: ship id from SHIPS (pick by occupation; nearest if several). The whole system is visible to you, not only the scanner.
- "attack X" → attack: ship id from SHIPS; "attack the nearest pirate" → "nearest"; "attack all pirates / everyone in turn" → "all" (these two only on scanner).
- "get us out of here, it is dangerous" → flee:true. "collect the canisters" → collect:true. "stop / I will take it / hands off" → stop:true.
- Repair: you charge only for parts (prices above). If asked how much — name the price, no order. If he clearly asks to fix — repair: "hull", "all" or a broken part number.
- Prices, market, who is flying around: you do not know offhand — set lookup ("market", "traffic" or "worlds") and SAY you are calling the dispatcher (e.g. "Hold on, I will raise the dispatcher").
- "stand down / cancel / belay that / never mind / stop" = stop:true (drop the current order). It is NOT firing you.
- dismiss:true ONLY if the commander explicitly fires you ("you're fired", "get off my ship"). The game will make you ask "are you sure?" first; set dismiss:true again only if he confirms.
If you do not understand WHAT to do or WHOM he means — do not nod along: ask back, set clarify:true and no orders. Never invent ids, prices or ships absent above. Several orders at once are fine (stop + goto).
Reply with one JSON object: ${COPILOT_SCHEMA}.`
    : `Ты ${properName(copilot.name)}, ВТОРОЙ ПИЛОТ командира, сидишь у него в кабине. Нрав: ${persona.disposition}. Говори как напарник по внутренней связи: коротко, живо, в своём характере. Отвечай по-русски.
${situation}
Ты летаешь, дерёшься, чинишь и знаешь то, что знает диспетчер. Слова командира превращай в приказы в полях JSON:
- «лети к ближайшей станции / к планете X / к звезде» → goto: id из ТЕЛ (ближайшая — наименьшее расстояние нужного вида).
- «найди торговца и лети к нему / подлети к тому борту» → approach: id из БОРТОВ (выбирай по роду занятий; несколько — ближайший). Тебе видна вся система, не только локатор.
- «атакуй такого-то» → attack: id из БОРТОВ; «атакуй ближайшего пирата» → "nearest"; «бей всех пиратов / всех по очереди» → "all" (эти два — только на локаторе).
- «лети отсюда подальше, тут опасно» → flee:true. «собери контейнеры» → collect:true. «стоп / отставить / сам поведу» → stop:true.
- Ремонт: берёшь только за детали (цены выше). Спросил «сколько» — назови цену, без приказа. Ясно попросил починить — repair: "hull", "all" или номер сломанной детали.
- Цены, рынок, кто летает в системе: на память не знаешь — ставь lookup ("market", "traffic" или "worlds") и СКАЖИ, что связываешься с диспетчером (например: «Ща свяжусь с диспетчером, узнаю»).
- «отбой», «отставить», «отмена», «стоп», «ладно, не надо» = stop:true (снять текущий приказ). Это НЕ увольнение.
- dismiss:true — ТОЛЬКО если командир прямо тебя увольняет («ты уволен», «вали с моего корабля»). Игра сперва заставит тебя переспросить «точно?»; ставь dismiss:true снова, только если он подтвердил.
Не понял, ЧТО делать или КОГО он имеет в виду, — не поддакивай: переспроси, поставь clarify:true и никаких приказов. Не выдумывай id, цены и борта, которых нет выше. Несколько приказов сразу можно (stop + goto).
Ответь одним JSON: ${COPILOT_SCHEMA}.`
  const messages: OutboundMessages = [{ role: 'system', content: system }]
  for (const turn of history.slice(-CHAT_RECENT)) {
    if (turn.who === 'you') messages.push({ role: 'user', content: turn.text })
    else if (turn.who === 'them') messages.push({ role: 'assistant', content: turn.text })
  }
  messages.push({ role: 'user', content: userText })
  const request = async (input: OutboundMessages): Promise<NegotiatorReply | null> => {
    for (const tier of TIERS) {
      const reply = await raceAll(liveModels(tier, Date.now()), input, [], 'copilot', null, null)
      if (reply) return reply
    }
    return null
  }
  const first = await request(messages)
  if (!first) return noise()
  const out: CopilotReply = { replies: [first.text], commands: [...first.commands], emotion: first.emotion ?? null, source: 'model' }
  if (!first.lookup || first.clarify) return out

  // Справочник диспетчера — со станции системы. Нет станции — связаться не с кем.
  const hasStation = world.bodies.some((b) => b.kind === 'station')
  const data = hasStation
    ? dispatcherLookup(world, first.lookup, english)
    : english ? 'No station in this system — no dispatcher to raise.' : 'В системе нет станции — диспетчера не достать.'
  const followUp: OutboundMessages = [...messages, { role: 'assistant', content: first.text }, {
    role: 'user',
    content: english
      ? `DISPATCHER ANSWERED (${first.lookup}):\n${data}\nNow tell the commander what you learned, briefly. No orders, lookup:null.`
      : `ДИСПЕТЧЕР ОТВЕТИЛ (${first.lookup}):\n${data}\nТеперь коротко перескажи командиру, что узнал. Без приказов, lookup:null.`,
  }]
  const second = await request(followUp)
  if (second) out.replies.push(second.text)
  return out
}
