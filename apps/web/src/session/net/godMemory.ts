import { onValue, ref, set } from 'firebase/database'
import { SLOVO_KIND, type AcquaintanceEvent, type Relationship, type World } from '@elite/sim'
import { currentUserId } from './account'
import { rtdb } from './firebase'
import { subscribeOnline, type OnlinePlayer } from './presence'

/**
 * ОБЩАЯ ПАМЯТЬ БОГА. Слово — бог, ему положено знать всех: кто его находил и что между ними
 * было. Журнал знакомства у каждого игрока свой (сейв), а здесь — его отражение для бога:
 * имя, как он к смертному относится и последние общие дела. Пишет каждый о СЕБЕ после разговора
 * с богом; читают все — в промпт бога, когда говорят с ним.
 *
 * Факты — события журнала (сделки, статуэтки, обиды, просьбы), а не пересказ модели: бог не
 * сочинит о другом игроке того, чего не было. Узел — `god/{зерно галактики}/{uid}`: в другой
 * галактике другой мир, и знакомства там свои.
 */

export interface GodVisitor {
  uid: string
  name: string
  rel: Relationship
  /** Момент последнего события (календарь мира). */
  at: number
  /** Последние события между ним и богом. */
  h: AcquaintanceEvent[]
}

/** Сколько последних событий о каждом смертном помнит общая память. */
const KEEP_EVENTS = 8

let watchedSeed: number | null = null
let unsubGod: (() => void) | null = null
let unsubOnline: (() => void) | null = null
let visitors: GodVisitor[] = []
let online: OnlinePlayer[] = []

/** Начать слушать память бога этой галактики (и кто в сети). Повторный вызов — дёшев. */
export function watchGodMemory(galaxySeed: number): void {
  if (!rtdb || watchedSeed === galaxySeed) return
  unsubGod?.()
  watchedSeed = galaxySeed
  unsubGod = onValue(
    ref(rtdb, `god/${galaxySeed >>> 0}`),
    (snap) => {
      const val = (snap.val() ?? {}) as Record<string, Partial<GodVisitor>>
      visitors = Object.entries(val)
        .filter(([, v]) => typeof v?.name === 'string')
        .map(([uid, v]) => ({
          uid,
          name: v.name!,
          rel: (v.rel as Relationship) ?? 'neutral',
          at: typeof v.at === 'number' ? v.at : 0,
          h: Array.isArray(v.h) ? (v.h as AcquaintanceEvent[]) : [],
        }))
    },
    () => {
      visitors = []
    },
  )
  unsubOnline ??= subscribeOnline((list) => {
    online = list
  })
}

/** Кто говорил с богом, кроме меня — свежие сверху. */
export function godVisitors(): GodVisitor[] {
  const me = currentUserId()
  return visitors.filter((v) => v.uid !== me).sort((a, b) => b.at - a.at)
}

/** Кого бог знает лишь по имени: в сети, но к нему не приходил. */
export function godHearsOf(): string[] {
  const met = new Set(visitors.map((v) => v.uid))
  const me = currentUserId()
  return online.filter((p) => p.uid !== me && !met.has(p.uid)).map((p) => p.name)
}

/** Записать о себе: что между мной и богом. Зовётся после разговора с ним. */
export function publishGodMemory(world: World): void {
  if (!rtdb) return
  const me = currentUserId()
  if (!me) return
  const rec = world.acquaintances.find((a) => a.kindId === SLOVO_KIND)
  if (!rec) return
  const h = rec.history.slice(-KEEP_EVENTS)
  void set(ref(rtdb, `god/${world.galaxySeed >>> 0}/${me}`), {
    name: world.player.pilotName,
    rel: rec.relationship,
    at: h[h.length - 1]?.at ?? world.calendarTime,
    h,
  }).catch(() => {})
}
