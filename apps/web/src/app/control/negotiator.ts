import { extractModelJson, parseModelReply, type Persona, type Topic } from '@elite/sim'
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

const GROQ_DEFAULT_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'moonshotai/kimi-k2-instruct',
  'qwen/qwen3-32b',
  'gemma2-9b-it',
]

const DEFAULT_MODELS = [
  'openai/gpt-oss-120b:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'google/gemma-4-31b-it:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
  'openai/gpt-oss-20b:free',
  'tencent/hy3:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'liquid/lfm-2.5-1.2b-instruct:free',
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

export function negotiationPayloadChars(ctx: NegotiationContext, history: ChatTurn[], userText: string): number {
  return buildMessages(ctx, history, userText).chars
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
      body: JSON.stringify({ model: ref.model, messages, temperature: 0.72, max_tokens: 300 }),
    })
    if (!res.ok) {
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

const RETRY_BACKOFF_MS = 700
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function raceAll(refs: ModelRef[], messages: OutboundMessages, allowed: Topic[]): Promise<NegotiatorReply | null> {
  return new Promise((resolve) => {
    let pending = refs.length
    let done = false
    for (const ref of refs) {
      void callModel(ref, messages).then((raw) => {
        if (done) return
        const reply = raw ? toReply(parseModelReply(extractModelJson(raw), allowed)) : null
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

  for (let attempt = 0; attempt < 2; attempt++) {
    for (const tier of TIERS) {
      const reply = await raceAll(tier, messages, ctx.allowedIntents)
      if (reply) {
        if (reply.hangup && chars >= PROMPT_SOFT_CHARS) return { ...reply, source: 'overload' }
        return reply
      }
    }
    if (attempt === 0) await delay(RETRY_BACKOFF_MS)
  }
  return staticNoise(history)
}
