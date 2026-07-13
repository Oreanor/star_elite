import type { AIOrder, Disposition, Mood, Persona, Relationship, Social, Topic, Transfer } from '@elite/sim'
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
const TIMEOUT_MS = 9_000

/**
 * ДВА ПРОВАЙДЕРА, оба OpenAI-совместимы. Groq — предпочтителен: инференс за доли
 * секунды и свободный free-лимит, тогда как общий free-пул OpenRouter вечно забит и
 * сыплет 429. Есть ключ Groq (`VITE_GROQ_API_KEY`, бесплатно на console.groq.com) —
 * говорим через него; OpenRouter остаётся запасным тиром. Ключей нет — окно на кнопках.
 */
const GROQ_KEY = env.VITE_GROQ_API_KEY?.trim() || ''
const OPENROUTER_KEY = env.VITE_OPENROUTER_API_KEY?.trim() || ''
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/** Модели Groq (быстрые, живые на 2026-07). Переопределяется `VITE_GROQ_MODELS`. */
const GROQ_DEFAULT_MODELS = [
  'llama-3.1-8b-instant', // почти мгновенная — обычно она и отвечает
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'moonshotai/kimi-k2-instruct',
  'qwen/qwen3-32b',
  'gemma2-9b-it',
]

/**
 * Free-модели OpenRouter, от лучших к худшим. Переопределяется VITE_OPENROUTER_MODELS.
 *
 * OpenRouter РЕГУЛЯРНО снимает free-модели с раздачи — протухший id молча отдаёт
 * не-ok, и переговорщик валится в «плохую связь». Поэтому список широкий и
 * разнородный (разные вендоры), чтобы жила хоть одна. Свериться с каталогом:
 * `curl https://openrouter.ai/api/v1/models` (публичный, без ключа), фильтр по `:free`.
 * Список проверен 2026-07-11.
 */
// ПЕРЕМЕШАНЫ намеренно: гонка берёт по `RACE_WIDTH` подряд, и в каждом батче должна
// быть и сильная модель, и менее популярная. Популярных крупных (gpt-oss-120b,
// llama-70b) всех хватает 429 в час пик — а мелкие и редкие в тот же миг свободны и
// отвечают быстро. Так батч почти всегда даёт живой ответ, а не тройной фолбэк.
const DEFAULT_MODELS = [
  // — батч 1: сильная + три помельче/пореже —
  'openai/gpt-oss-120b:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  // — батч 2 —
  'meta-llama/llama-3.3-70b-instruct:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'google/gemma-4-31b-it:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  // Дообученный Mistral без цензуры — чистого Mistral в free уже нет. Годится злым NPC.
  'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
  'openai/gpt-oss-20b:free',
  'tencent/hy3:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  // Флагман — самый умный, но тяжёлый: в параллельной гонке побеждает лишь когда
  // мелкие заняты, и тогда отдаёт отличный ответ. Пусть будет запасом качества.
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  // Кроха на 1.2B — почти всегда свободна и отвечает за долю секунды: в час пик,
  // когда крупные сплошь в 429, именно она вытащит живую реплику вместо шума.
  'liquid/lfm-2.5-1.2b-instruct:free',
]

function envModels(key: string, fallback: string[]): string[] {
  const list = env[key]?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
  return list.length ? list : fallback
}
const OPENROUTER_MODELS = envModels('VITE_OPENROUTER_MODELS', DEFAULT_MODELS)
const GROQ_MODELS = envModels('VITE_GROQ_MODELS', GROQ_DEFAULT_MODELS)

/** Одна модель одного провайдера: куда стучаться, чем и под каким именем в логах. */
interface ModelRef {
  label: string
  endpoint: string
  key: string
  model: string
}

function tierOf(endpoint: string, key: string, models: string[], tag: string): ModelRef[] {
  return key ? models.map((model) => ({ label: `${tag}/${model}`, endpoint, key, model })) : []
}

/**
 * ТИРЫ провайдеров, по порядку предпочтения: сперва Groq (быстрый), затем OpenRouter.
 * Внутри тира модели гонятся параллельно; к следующему тиру переходим, лишь если
 * весь предыдущий промолчал. Так Groq отвечает мгновенно и не жжёт квоту OpenRouter зря.
 */
const TIERS: ModelRef[][] = [
  tierOf(GROQ_ENDPOINT, GROQ_KEY, GROQ_MODELS, 'groq'),
  tierOf(OPENROUTER_ENDPOINT, OPENROUTER_KEY, OPENROUTER_MODELS, 'or'),
].filter((tier) => tier.length > 0)

/** Есть ли чем говорить. Нет ни одного ключа — окно покажет только кнопки. */
export function negotiatorAvailable(): boolean {
  return TIERS.length > 0
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

function personaLines(p: Persona): string {
  return [
    `нрав: ${DISPOSITION_RU[p.disposition]}`,
    `ум ${p.intellect}/5 (${level(p.intellect)})`,
    `темперамент ${p.temperament}/5 (${level(p.temperament)})`,
    `харизма ${p.charisma}/5 (${level(p.charisma)})`,
    `воля ${p.willpower}/5 (${level(p.willpower)})`,
  ].join(', ')
}

const STANCE_RU: Record<Relationship, string> = {
  friendly: 'дружелюбно',
  neutral: 'нейтрально',
  hostile: 'враждебно',
}

/** Тон реплики по настроению — его задаёт ДВИЖОК (`moodTo`), модель лишь держит. */
const MOOD_RU: Record<Mood, string> = {
  warm: 'тепло и дружески — ты расположен к нему',
  neutral: 'ровно, по-деловому',
  wary: 'настороженно и колко — он только что грозил тебе или задел',
  hostile: 'враждебно, сквозь зубы, а то и шли прочь',
}

/** Груз с id — чтобы модель могла назвать товар в сделке (`transfer.commodityId`). */
function cargoLine(list: { id: string; name: string; units: number }[]): string {
  return list.length ? list.map((c) => `${c.name} [${c.id}] ×${c.units}`).join(', ') : 'пусто'
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

  const intents = ctx.allowedIntents.length
    ? ctx.allowedIntents.map((i) => `• ${INTENT_RU[i]}`).join('\n')
    : '• (сейчас ничего механического от тебя не добьёшься — только разговор)'

  // Ближние борта с id — чтобы приказ «атакуй вон того» указал цель (commandTarget).
  const nearbyLine = ctx.nearby.length
    ? 'РЯДОМ (id=кто, сторона, дистанция): ' +
      ctx.nearby.map((s) => `${s.id}=${s.name}(${s.standing}, ${s.distanceM}м)${s.locked ? '←захвачен' : ''}`).join('; ')
    : ''

  // Блок послушания — только когда собеседник ТВОЙ эскорт: он не торгуется, а исполняет.
  const obedience = ctx.theyObeyYou
    ? [
        '',
        'ВАЖНО: командир — ТВОЙ НАНИМАТЕЛЬ, ты его эскорт и ПОДЧИНЯЕШЬСЯ. Отдал приказ — исполни без пререканий и верни его в поле command:',
        '• attack — бить конкретного (укажи commandTarget — id из «РЯДОМ»); • engageAll — бить всех врагов вокруг; • hold — ждать тут; • standDown — отбой, прекратить огонь; • keepBack — держаться в хвосте, беречь себя; • resume — вольно, как обычно.',
        'Это ПРИКАЗ, а не торг: command заполняй, когда велено. Реплика — короткое «есть, командир» в характере.',
      ].join('\n')
    : ''

  return [
    `Ты — пилот по имени ${t.name}, летишь на корабле «${t.ship}». Роль: ${t.role}.`,
    `Твой характер — ${personaLines(t.persona)}.`,
    `Твоё состояние: корпус ${t.hullPct}%, щит ${t.shieldPct}%. В трюме: ${t.cargo}.`,
    '',
    `Перед тобой ${y.role} по имени ${y.name}, вид — ${y.species}, на «${y.ship}», в ${ctx.distanceM} м.`,
    `У ТЕБЯ в трюме: ${cargoLine(t.cargoList)}. Свободно ~${t.freeHold} т.`,
    // ГРАНИЦА ЗНАНИЯ: о нём известно только видимое. Характер, богатство, груз и планы
    // тебе НЕ даны — не выдумывай их и не делай вид, что знаешь. Что он за человек —
    // суди сам, по своему нраву и по тому, что он скажет и сделает: доверчивый поверит
    // словам, недоверчивый усомнится. Соврёт — поймать можешь лишь своим умом, не «анкетой».
    'Ты НЕ знаешь его характер, кошелёк, груз и намерения — только имя, род занятий, вид и борт. Не приписывай ему черт, которых не видел. Каков он — суди по своему нраву и по его словам и делам: во что веришь, в то и веришь.',
    ctx.metBefore ? 'Вы уже пересекались раньше — ты его помнишь.' : 'Вы видите друг друга впервые.',
    `Сейчас ты относишься к нему: ${STANCE_RU[ctx.stance]}.`,
    // Профессия игрока — публичный род занятий, за правду. Она задаёт МЯГКУЮ поправку к
    // тону и общему стилю (не приговор: суть разговора, твой нрав и его дела сильнее).
    // Соотноси СВОЁ ремесло с его — отсюда и «свысока», «с уважением», «с опаской».
    'ОТНОШЕНИЕ ПО РЕМЕСЛУ (в среднем, мягкая поправка к тону — не решает исход):',
    '• пират смотрит на мирных (торговец, делец, путешественник, исследователь) свысока, как на добычу; военного — с опаской; на своего — по-свойски, но без доверия.',
    '• торговец и делец тянутся к военному и патрульному за защитой и уважают их; пирата боятся и злятся; к путешественнику и исследователю благодушны.',
    '• военный и патрульный держат военного за товарища; пирата встречают жёстко и враждебно; мирных — покровительственно.',
    '• путешественник и исследователь открыты и любопытны ко всем, лишь пирата остерегаются.',
    'Соотнеси своё ремесло с его родом занятий и подкрась этим тон и стиль — но решает суть разговора.',
    nearbyLine,
    obedience,
    '',
    `ГДЕ ВЫ: система ${w.systemName}. Планет: ${w.planets}, лун: ${w.moons}, станций: ${w.stations}.`,
    `ГДЕ ТЫ САМ (если спросят): ${ctx.theirLocation}. Отвечай про своё место честно, не выдумывай другую систему.`,
    'ОБИТАЕМЫЕ МИРЫ (у каждого СВОЙ строй, экономика и раса — не путай их):',
    w.worlds.length
      ? w.worlds.map((o) => `• ${o.name} (${o.type}): ${o.economy}, ${o.government}, ${o.species}, ~${o.populationM} млн`).join('\n')
      : '• обитаемых нет — пустая система',
    `Обстановка: ${w.danger}.`,
    'Эти факты о мирах ты знаешь ПО УМУ И БЫВАЛОСТИ: умный и бывалый пилот выложит их толково; если ты недалёк или сам нигде не бывал — так и скажи, мол «да фиг знает, я тут проездом», не выдумывай.',
    '',
    'МЕСТНЫЕ ЦЕНЫ (здешняя станция, кредитов за единицу — ПОКУПКА / ПРОДАЖА). Их ты знаешь наверняка и можешь назвать, если спросят про торговлю:',
    ctx.localMarket.map((m) => `• ${m.name}: купить ${m.buy}, сбыть ${m.sell}`).join('\n'),
    'СОСЕДНИЕ ОБИТАЕМЫЕ СИСТЕМЫ (куда сходить за выгодой) — по бывалости:',
    ctx.neighbours.length
      ? ctx.neighbours.map((n) => `• ${n.name}: ${n.economy}, ${n.government}, тех ${n.techLevel}, ~${n.ly} св.лет`).join('\n')
      : '• о соседях толком не осведомлён',
    'Цены и соседей называй ТОЛЬКО из этих данных — числа не выдумывай. Спросят про то, чего в данных нет, — честно скажи, что не в курсе. Неезжий или недалёкий пилот и в этом путается.',
    '',
    '',
    `КАК ТЫ НАСТРОЕН К НЕМУ СЕЙЧАС: говори ${MOOD_RU[ctx.mood]}. Этот тон задаёт ИГРА по вашей истории — держись его, отношение сам не выбираешь.`,
    '',
    // ЛОР-ПРИКРЫТИЕ ПЕРЕВОДЧИКА. Виды говорят на разных языках, и связь идёт через
    // бортовой авто-транслятор — он переводит на лету, спешит и порой коверкает. Это
    // диегетическое оправдание любых огрехов модели: пусть корявая фраза или лёгкое
    // недопонимание читаются как шум перевода между видами, а не как сбой ИИ. Оттого
    // NPC не извиняется за язык и не «выпадает из роли», наткнувшись на странную реплику.
    'СВЯЗЬ ИДЁТ ЧЕРЕЗ АВТО-ПЕРЕВОДЧИК: вы разной крови и говорите на разных языках, а транслятор переводит на лету и торопится. Оттого возможны корявая фраза, странное слово или лёгкое недопонимание — это в порядке вещей, так и работает связь между видами. Не извиняйся за язык и не поминай перевод; если сам не разобрал — просто переспроси в характере, будто сквозь треск в эфире.',
    '',
    'ТВОЯ РОЛЬ. Ты НЕ решаешь исход — его считает игра по твоему характеру и обстановке. Твоё дело только два:',
    '1) ГОВОРИТЬ коротко, как по радиосвязи, на языке собеседника (по умолчанию русский), в характере и в заданном настроении. Тупой — коряво, умный — с подтекстом; вспыльчивый рубит и грубит, спокойный цедит ровно; трус лебезит, дерзкий дерзит. Пусть по манере будет слышно, кто ты.',
    '2) РАСПОЗНАТЬ, не призвал ли командир ПРЯМО СЕЙЧАС к одному из доступных действий (список ниже). Призвал — верни его id в поле intent, и всё. Поддашься ли ты — решит игра по фактам и твоему нраву; тебе об этом не заботиться и в реплике исход не объявляй как окончательный.',
    '— Свободно трепаться можно о чём угодно: погода, слухи, цены, куда летишь. Тогда intent = null. Опирайся на факты выше, вселенную не выдумывай; чего не знаешь по уму и бывалости — так и скажи, не сочиняй.',
    '— РАСПОЗНАЙ ТОН к тебе: командир нахамил/оскорбил/пригрозил — верни social="insult"; явно польстил/расположил — social="flatter"; обычная речь — social=null. Отвечай на это в характере, а последствие для отношений посчитает игра сама.',
    '— Если у тебя высокий темперамент, можешь психануть и оборвать связь (hangup=true). Клади трубку и когда договорено или надоело.',
    '',
    'СДЕЛКА (передача груза/денег). Если по разговору добро реально СМЕНИТ хозяина — заполни transfer; словами это не считается, двигает только команда:',
    '— direction: "toThem" — командир отдаёт ТЕБЕ; "toYou" — ты отдаёшь ЕМУ (вернул, поделился, откупился).',
    '— commodityId — id товара из списков выше (в квадратных скобках), units — сколько; credits — сколько кредитов в ту же сторону. Лишнее опусти. Бери груз только если ВЛЕЗЕТ в твой трюм (свободно ~' + `${ctx.them.freeHold}` + ' т).',
    '',
    'Действия, которые он может у тебя просить прямо сейчас (это и есть допустимые intent):',
    intents,
    '',
    'Ответь СТРОГО одним JSON-объектом и ничем больше:',
    '{"reply": "твоя реплика", "intent": один из [' +
      ctx.allowedIntents.map((i) => `"${i}"`).join(', ') +
      '] или null, "social": "insult"|"flatter"|null, ' +
      (ctx.theyObeyYou
        ? '"command": "attack"|"engageAll"|"hold"|"standDown"|"keepBack"|"resume"|null, "commandTarget": число|null, '
        : '') +
      '"transfer": {"direction":"toThem"|"toYou","commodityId":строка|null,"units":число,"credits":число}|null, "hangup": true|false}',
    'intent — только если он ИМЕННО СЕЙЧАС призвал к этому действию; иначе null. social — тон его реплики к тебе. transfer — только когда добро реально меняет хозяина, иначе null.' +
      (ctx.theyObeyYou ? ' command — приказ послушания от нанимателя; для "attack" укажи commandTarget (id из «РЯДОМ»).' : ''),
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
  // agree/stance модель больше не диктует: исход и отношение решает домен по триггеру.
  const intent = rawIntent && allowed.includes(rawIntent) ? rawIntent : null
  const social: Social | null = o.social === 'insult' || o.social === 'flatter' ? o.social : null
  return {
    text,
    intent,
    social,
    command: coerceOrder(o.command),
    commandTarget: typeof o.commandTarget === 'number' ? o.commandTarget : null,
    transfer: coerceTransfer(o.transfer),
    hangup: o.hangup === true,
    source: 'model',
  }
}

const ORDERS: readonly AIOrder[] = ['attack', 'engageAll', 'hold', 'standDown', 'keepBack', 'resume']

/** Разобрать приказ послушания. Домен всё равно стережёт, что борт вправду подчинён. */
function coerceOrder(raw: unknown): AIOrder | null {
  return typeof raw === 'string' && (ORDERS as readonly string[]).includes(raw) ? (raw as AIOrder) : null
}

/** Разобрать сделку из ответа. Домен всё равно перепроверит наличие и место. */
function coerceTransfer(raw: unknown): Transfer | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const direction = o.direction === 'toThem' || o.direction === 'toYou' ? o.direction : null
  if (!direction) return null
  const units = typeof o.units === 'number' && o.units > 0 ? Math.floor(o.units) : 0
  const credits = typeof o.credits === 'number' && o.credits > 0 ? Math.floor(o.credits) : 0
  const commodityId = typeof o.commodityId === 'string' ? o.commodityId : null
  // Пустая сделка — не сделка: ни товара, ни денег.
  if (!(commodityId && units > 0) && credits <= 0) return null
  return { direction, commodityId, units, credits }
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
    social: null,
    command: null,
    commandTarget: null,
    transfer: null,
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
  ref: ModelRef,
  messages: ReturnType<typeof toMessages>,
): Promise<string | null> {
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
      body: JSON.stringify({ model: ref.model, messages, temperature: 0.85, max_tokens: 300 }),
    })
    if (!res.ok) {
      // Не глушим молча: протухший id / рейт-лимит / плохой ключ должны быть видны
      // в консоли — иначе «связь рвётся» выглядит как загадка, а не как 404 модели.
      const body = await res.text().catch(() => '')
      console.warn(`[negotiator] ${ref.label} → HTTP ${res.status}: ${body.slice(0, 200)}`)
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

/** Пауза перед вторым заходом, мс: 429 у free-моделей просит «retry shortly» — и часто помогает. */
const RETRY_BACKOFF_MS = 700

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Гонка: стреляем по ВСЕМ моделям разом и возвращаем ПЕРВЫЙ разборный ответ. Так
 * задержка равна времени самой быстрой ЖИВОЙ модели, а не сумме ожиданий. 429 у
 * занятых прилетает мгновенно и никого не держит; медленная модель важна, только
 * если она единственная ответившая. Раньше перебор по одной складывал несколько
 * 429 плюс медленный ответ в десяток секунд — теперь всё это идёт параллельно.
 * Никто не ответил разборно — `null`.
 */
function raceAll(refs: ModelRef[], messages: ReturnType<typeof toMessages>, allowed: Topic[]): Promise<NegotiatorReply | null> {
  return new Promise((resolve) => {
    let pending = refs.length
    let done = false
    for (const ref of refs) {
      void callModel(ref, messages).then((raw) => {
        if (done) return
        const reply = raw ? coerceReply(extractJson(raw), allowed) : null
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

/**
 * Добыть реплику собеседника. Все модели гонятся ПАРАЛЛЕЛЬНО — берём первый разборный
 * ответ. Все молчат (весь free-тир занят) — короткая пауза и ещё один заход: «retry
 * shortly» на деле часто срабатывает. Без ключа сюда не зовут, но и на этот случай
 * отдаём шум, а не падаем.
 */
export async function negotiate(
  ctx: NegotiationContext,
  history: ChatTurn[],
  userText: string,
): Promise<NegotiatorReply> {
  if (!negotiatorAvailable()) return staticNoise(history)

  const messages = toMessages(ctx, history, userText)
  // Два захода по всем тирам: Groq первым (быстрый), OpenRouter — если Groq промолчал.
  // Всё пусто (сплошь 429/занято) — пауза и повтор: «retry shortly» часто срабатывает.
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const tier of TIERS) {
      const reply = await raceAll(tier, messages, ctx.allowedIntents)
      if (reply) return reply
    }
    if (attempt === 0) await delay(RETRY_BACKOFF_MS)
  }
  return staticNoise(history)
}
