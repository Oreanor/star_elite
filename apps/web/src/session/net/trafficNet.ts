import {
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
} from 'firebase/database'
import { currentUserId } from './account'
import { rtdb, serverNow } from './firebase'
import type { RosterEntry, TrafficFrame } from './trafficWire'

/**
 * ТРАНСПОРТ общего трафика (RTDB). Узел системы — `traffic/{зерно}-{система}`: номер системы
 * один и тот же в разных галактиках, а трафик у них разный.
 *
 *   host        — {uid, t}: кто хозяин и когда последний раз подтвердил это (пульс);
 *   own/{uid}   — борта владельца: реестр и кадр поз (см. `armOwnCleanup`);
 *   hits/{uid}  — урон по бортам владельца от остальных; pods — общие контейнеры.
 *
 * Хозяина выбирает ТРАНЗАКЦИЯ: занять роль можно, только если её нет, она твоя или пульс
 * хозяина протух. Двое разом не станут хозяевами — сервер пропустит одну запись.
 */

/** Пульс хозяина старше этого — роль свободна, мс. Пульс идёт раз в 2 с, пока его мир ЖИВЁТ. */
export const HOST_STALE_MS = 4500

export interface HostInfo {
  uid: string
  t: number
}

export const trafficKey = (galaxySeed: number, systemIndex: number): string => `${galaxySeed >>> 0}-${systemIndex}`

const path = (key: string, sub: string): string => `traffic/${key}/${sub}`

export function hostStale(h: HostInfo | null): boolean {
  return h == null || serverNow() - h.t > HOST_STALE_MS
}

/** Подписка на хозяина системы. */
export function subscribeHost(key: string, cb: (h: HostInfo | null) => void): () => void {
  if (!rtdb) return () => {}
  return onValue(ref(rtdb, path(key, 'host')), (snap) => {
    const v = snap.val() as Partial<HostInfo> | null
    cb(v && typeof v.uid === 'string' && typeof v.t === 'number' ? { uid: v.uid, t: v.t } : null)
  })
}

/** Занять роль хозяина. Удалось — на узел вешается `onDisconnect`: отвалился — роль освободится. */
export async function claimHost(key: string): Promise<boolean> {
  if (!rtdb) return false
  const me = currentUserId()
  if (!me) return false
  const node = ref(rtdb, path(key, 'host'))
  try {
    const result = await runTransaction(node, (cur: Partial<HostInfo> | null) => {
      if (cur && cur.uid !== me && typeof cur.t === 'number' && serverNow() - cur.t <= HOST_STALE_MS) return undefined
      return { uid: me, t: serverTimestamp() }
    })
    if (!result.committed) return false
    void onDisconnect(node).remove()
    return true
  } catch {
    // Правила не пускают (не выкачены) или сети нет: остаёмся каждый при своём трафике.
    return false
  }
}

/** Пульс: «я хозяин и мой мир живёт». */
export async function heartbeat(key: string): Promise<void> {
  if (!rtdb) return
  const me = currentUserId()
  if (!me) return
  await set(ref(rtdb, path(key, 'host')), { uid: me, t: serverTimestamp() }).catch(() => {})
}

/** Отпустить роль (прыжок, выход). Только свою: чужую транзакция не тронет. */
export async function releaseHost(key: string): Promise<void> {
  if (!rtdb) return
  const me = currentUserId()
  if (!me) return
  await runTransaction(ref(rtdb, path(key, 'host')), (cur: Partial<HostInfo> | null) => (cur?.uid === me ? null : undefined)).catch(() => {})
}

/**
 * Узел владельца — `own/{uid}`: реестр его бортов и кадр их поз. Владеет каждый: хозяин
 * системы — трафиком, любой игрок — своими наёмниками и попутчиками. Отвалился — узел
 * исчезнет сам (`onDisconnect`), и копии его бортов у остальных уйдут.
 */
const own = (key: string, uid: string, sub: string): string => path(key, `own/${uid}/${sub}`)

/** Повесить уборку своего узла на обрыв. Раз на систему. */
export function armOwnCleanup(key: string): void {
  if (!rtdb) return
  const me = currentUserId()
  if (!me) return
  void onDisconnect(ref(rtdb, path(key, `own/${me}`))).remove()
}

/** Снять свой узел целиком (ушёл из системы). */
export async function clearOwn(key: string): Promise<void> {
  if (!rtdb) return
  const me = currentUserId()
  if (!me) return
  await remove(ref(rtdb, path(key, `own/${me}`))).catch(() => {})
}

export async function publishRosterEntry(key: string, id: number, entry: RosterEntry | null): Promise<void> {
  if (!rtdb) return
  const me = currentUserId()
  if (!me) return
  await set(ref(rtdb, own(key, me, `roster/${id}`)), entry).catch(() => {})
}

export async function publishFrame(key: string, frame: Omit<TrafficFrame, 't'>): Promise<void> {
  if (!rtdb) return
  const me = currentUserId()
  if (!me) return
  await set(ref(rtdb, own(key, me, 'frame')), { ...frame, t: serverTimestamp() }).catch(() => {})
}

export function subscribeRoster(key: string, owner: string, cb: (roster: Record<string, RosterEntry>) => void): () => void {
  if (!rtdb) return () => {}
  return onValue(
    ref(rtdb, own(key, owner, 'roster')),
    (snap) => cb((snap.val() ?? {}) as Record<string, RosterEntry>),
    () => cb({}),
  )
}

export function subscribeFrame(key: string, owner: string, cb: (frame: TrafficFrame | null) => void): () => void {
  if (!rtdb) return () => {}
  return onValue(
    ref(rtdb, own(key, owner, 'frame')),
    (snap) => {
      const v = snap.val() as TrafficFrame | null
      cb(v && typeof v.t === 'number' ? { t: v.t, s: v.s ?? {}, m: v.m ?? {} } : null)
    },
    () => cb(null),
  )
}

/** Урон по борту владельца `owner`: в его ящик, применит он сам. */
export async function sendBotHit(key: string, owner: string, shipId: number, damage: number): Promise<void> {
  if (!rtdb) return
  const from = currentUserId()
  if (!from) return
  await push(ref(rtdb, path(key, `hits/${owner}`)), { hid: shipId, dmg: damage, from }).catch(() => {})
}

/** Свой ящик урона по своим бортам. Запись расходуемая: принял — стёр. */
export function subscribeBotHits(key: string, cb: (shipId: number, damage: number, fromUid: string) => void): () => void {
  if (!rtdb) return () => {}
  const me = currentUserId()
  if (!me) return () => {}
  return onChildAdded(ref(rtdb, path(key, `hits/${me}`)), (snap) => {
    const v = snap.val() as { hid?: number; dmg?: number; from?: string } | null
    void remove(snap.ref).catch(() => {})
    if (v && typeof v.hid === 'number' && typeof v.dmg === 'number' && v.dmg > 0 && typeof v.from === 'string') cb(v.hid, v.dmg, v.from)
  })
}

/**
 * ДЕЛА У БОТОВ ВЛАДЕЛЬЦА. Гость взялся за дело копии — просит владельца снять оферту и (для
 * охоты и сноса) родить цели; владелец отвечает, какие борта и гнездо — цели. Ящики расходуемые.
 */
export interface JobRequest {
  hid: number
  cid: number
  from: string
}
export interface JobReply {
  cid: number
  /** Кто родил цели — по нему гость найдёт их копии (`владелец:id`). */
  owner: string
  ships: number[]
  /** Сетевой ключ гнезда или пусто. */
  plat: string
}

export async function sendJobRequest(key: string, owner: string, req: Omit<JobRequest, 'from'>): Promise<void> {
  if (!rtdb) return
  const from = currentUserId()
  if (!from) return
  await push(ref(rtdb, path(key, `jobreq/${owner}`)), { ...req, from }).catch(() => {})
}

export function subscribeJobRequests(key: string, cb: (req: JobRequest) => void): () => void {
  if (!rtdb) return () => {}
  const me = currentUserId()
  if (!me) return () => {}
  return onChildAdded(ref(rtdb, path(key, `jobreq/${me}`)), (snap) => {
    const v = snap.val() as Partial<JobRequest> | null
    void remove(snap.ref).catch(() => {})
    if (v && typeof v.hid === 'number' && typeof v.cid === 'number' && typeof v.from === 'string') cb(v as JobRequest)
  })
}

export async function sendJobReply(key: string, to: string, reply: JobReply): Promise<void> {
  if (!rtdb) return
  await push(ref(rtdb, path(key, `jobresp/${to}`)), { ...reply, ships: reply.ships.length ? reply.ships : null }).catch(() => {})
}

export function subscribeJobReplies(key: string, cb: (reply: JobReply) => void): () => void {
  if (!rtdb) return () => {}
  const me = currentUserId()
  if (!me) return () => {}
  return onChildAdded(ref(rtdb, path(key, `jobresp/${me}`)), (snap) => {
    const v = snap.val() as Partial<JobReply> | null
    void remove(snap.ref).catch(() => {})
    if (v && typeof v.cid === 'number' && typeof v.owner === 'string') {
      cb({ cid: v.cid, owner: v.owner, ships: Array.isArray(v.ships) ? v.ships : [], plat: typeof v.plat === 'string' ? v.plat : '' })
    }
  })
}
