import { onDisconnect, onValue, ref, serverTimestamp, update } from 'firebase/database'
import { LINKED_PORTAL, type World } from '@elite/sim'
import { jumpPortal, portalActive } from '../control/jumpPortal'
import { currentUserId } from './account'
import { rtdb, serverNow } from './firebase'

export interface PortalMouthSnapshot {
  x: number
  y: number
  z: number
  qx: number
  qy: number
  qz: number
  qw: number
}

export interface PortalTravelerSnapshot extends PortalMouthSnapshot {
  vx: number
  vy: number
  vz: number
  scale: number
}

/** Одна каноническая пара устьев. Проекции в `systemPortals` дублируются атомарно. */
export interface SharedPortalSnapshot {
  uid: string
  galaxySeed: number
  fromSystem: number
  toSystem: number
  radius: number
  from: PortalMouthSnapshot
  to: PortalMouthSnapshot
  traveler: PortalTravelerSnapshot
  t: number
  expiresAt: number
}

type PortalWire = Omit<SharedPortalSnapshot, 'uid' | 't'> & { t: number | object }

let lastFrom: number | null = null
let lastTo: number | null = null
let disconnectKey = ''
let expiresAt = 0

function mouth(
  pos: { x: number; y: number; z: number },
  quat: { x: number; y: number; z: number; w: number },
  ox = 0,
  oy = 0,
  oz = 0,
): PortalMouthSnapshot {
  return {
    x: pos.x + ox,
    y: pos.y + oy,
    z: pos.z + oz,
    qx: quat.x,
    qy: quat.y,
    qz: quat.z,
    qw: quat.w,
  }
}

/**
 * Опубликовать пару и текущую позу корабля одним multi-location update.
 * `from` всегда означает систему локального игрока СЕЙЧАС; после пролёта стороны
 * меняются ролями, но координаты обоих колец остаются прежними.
 */
export async function publishSharedPortal(world: World): Promise<boolean> {
  if (!rtdb || !portalActive()) return false
  const uid = currentUserId()
  const p = jumpPortal()
  if (!uid || !p.destReady) return false
  if (expiresAt === 0) expiresAt = serverNow() + LINKED_PORTAL.LIFE_SECONDS * 1000

  const off = world.originOffset
  const state = world.player.state
  const record: PortalWire = {
    galaxySeed: world.galaxySeed,
    fromSystem: p.hereIndex,
    toSystem: p.index,
    radius: p.ringRadius,
    from: mouth(p.ringPos, p.ringQuat, off.x, off.y, off.z),
    // Дальнее устье хранится в абсолютных координатах своей системы.
    to: mouth(p.destPos, p.destQuat),
    traveler: {
      ...mouth(state.pos, state.quat, off.x, off.y, off.z),
      vx: state.vel.x,
      vy: state.vel.y,
      vz: state.vel.z,
      scale: state.scale,
    },
    t: serverTimestamp(),
    expiresAt,
  }

  const writes: Record<string, PortalWire | null> = {
    [`portals/${uid}`]: record,
    [`systemPortals/${p.hereIndex}/${uid}`]: record,
    [`systemPortals/${p.index}/${uid}`]: record,
  }
  if (lastFrom !== null && lastFrom !== p.hereIndex && lastFrom !== p.index) {
    writes[`systemPortals/${lastFrom}/${uid}`] = null
  }
  if (lastTo !== null && lastTo !== p.hereIndex && lastTo !== p.index) {
    writes[`systemPortals/${lastTo}/${uid}`] = null
  }

  const key = `${p.hereIndex}:${p.index}`
  if (disconnectKey !== key) {
    disconnectKey = key
    void onDisconnect(ref(rtdb)).update({
      [`portals/${uid}`]: null,
      [`systemPortals/${p.hereIndex}/${uid}`]: null,
      [`systemPortals/${p.index}/${uid}`]: null,
    })
  }
  lastFrom = p.hereIndex
  lastTo = p.index
  await update(ref(rtdb), writes)
  return true
}

/** Закрыть сразу оба устья и каноническую запись. */
export async function clearSharedPortal(): Promise<void> {
  const from = lastFrom
  const to = lastTo
  lastFrom = null
  lastTo = null
  disconnectKey = ''
  expiresAt = 0
  if (!rtdb) return
  const uid = currentUserId()
  if (!uid) return
  const writes: Record<string, null> = { [`portals/${uid}`]: null }
  if (from !== null) writes[`systemPortals/${from}/${uid}`] = null
  if (to !== null) writes[`systemPortals/${to}/${uid}`] = null
  await update(ref(rtdb), writes)
}

function validMouth(value: unknown): value is PortalMouthSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<PortalMouthSnapshot>
  return [v.x, v.y, v.z, v.qx, v.qy, v.qz, v.qw].every((n) => typeof n === 'number')
}

function parse(uid: string, value: unknown): SharedPortalSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<SharedPortalSnapshot>
  if (
    typeof v.galaxySeed !== 'number' ||
    typeof v.fromSystem !== 'number' ||
    typeof v.toSystem !== 'number' ||
    typeof v.radius !== 'number' ||
    typeof v.t !== 'number' ||
    typeof v.expiresAt !== 'number' ||
    !validMouth(v.from) ||
    !validMouth(v.to) ||
    !validMouth(v.traveler)
  ) return null
  const traveler = v.traveler as Partial<PortalTravelerSnapshot>
  if ([traveler.vx, traveler.vy, traveler.vz, traveler.scale].some((n) => typeof n !== 'number')) return null
  return { ...(v as Omit<SharedPortalSnapshot, 'uid'>), uid }
}

const STALE_MS = 90_000
let visible: readonly SharedPortalSnapshot[] = []

/** Императивный снимок для горячего пути рендера — без React setState на сетевой пакет. */
export function sharedPortalSnapshots(): readonly SharedPortalSnapshot[] {
  return visible
}

export function portalSnapshotActive(snapshot: SharedPortalSnapshot, now = serverNow()): boolean {
  return now <= snapshot.expiresAt && now - snapshot.t <= STALE_MS
}

export function remoteTravelerActive(uid: string): boolean {
  const now = serverNow()
  return visible.some((p) => p.uid === uid && portalSnapshotActive(p, now))
}

/** Подписка текущей сцены на одну системную проекцию канонических порталов. */
export function subscribeSharedPortals(
  systemIndex: number,
  onChange?: (snapshots: readonly SharedPortalSnapshot[]) => void,
): () => void {
  if (!rtdb) return () => {}
  const me = currentUserId()
  const unsubscribe = onValue(ref(rtdb, `systemPortals/${systemIndex}`), (snap) => {
    const raw = (snap.val() ?? {}) as Record<string, unknown>
    const next: SharedPortalSnapshot[] = []
    const now = serverNow()
    for (const [uid, value] of Object.entries(raw)) {
      if (uid === me) continue
      const p = parse(uid, value)
      if (p && portalSnapshotActive(p, now)) next.push(p)
    }
    visible = next
    onChange?.(next)
  })
  return () => {
    unsubscribe()
    visible = []
    onChange?.(visible)
  }
}
