import { Quaternion, Vector3 } from 'three'
import { onChildAdded, onChildRemoved, push, ref, remove, serverTimestamp, set } from 'firebase/database'
import { spawnNetTitan, type World } from '@elite/sim'
import { currentUserId } from './net/account'
import { rtdb, serverNow } from './net/firebase'
import { peerShips } from './net/peers'
import { trafficKey } from './net/trafficNet'

/**
 * ОБЩИЕ КИТЫ. Город-корабль рождает трафик хозяина системы; он неуязвим и дрейфует прямо
 * (или висит на рейде), поэтому хватает одного объявления — точка, дрейф, момент, облик — и у
 * всех кит в одном месте. Хозяин убрал кита (ушёл за горизонт) — снимает объявление, копия
 * исчезает у всех. Узел — `traffic/{система}/titans`, он не принадлежит хозяину: сменился
 * хозяин — киты остались.
 */

interface TitanNode {
  p: number[]
  v: number[]
  q: number[]
  t: number
  va: number
  n: string
  sp: number
  r: number
}

const _pos = new Vector3()
const _vel = new Vector3()
const _quat = new Quaternion()

export class SharedTitans {
  private key: string | null = null
  private unsub: (() => void)[] = []
  private incoming: { id: string; node: TitanNode }[] = []
  private gone: string[] = []
  private alive = new Set<string>()

  tick(world: World): void {
    if (!rtdb || !currentUserId()) return
    const key = trafficKey(world.galaxySeed, world.systemIndex)
    if (key !== this.key) this.attach(key)
    const base = `traffic/${key}/titans`
    const o = world.originOffset

    for (const { id, node } of this.incoming) {
      if (world.titans.some((t) => t.netId === id) || !Array.isArray(node.p) || !Array.isArray(node.v) || !Array.isArray(node.q)) continue
      const age = Math.max(0, (serverNow() - node.t) / 1000)
      _vel.set(node.v[0]!, node.v[1]!, node.v[2]!)
      _pos.set(node.p[0]! - o.x, node.p[1]! - o.y, node.p[2]! - o.z).addScaledVector(_vel, age)
      _quat.set(node.q[0]!, node.q[1]!, node.q[2]!, node.q[3]!)
      spawnNetTitan(world, id, { variant: node.va, name: node.n, pos: _pos, vel: _vel, quat: _quat, spin: node.sp, radius: node.r })
    }
    this.incoming.length = 0
    if (this.gone.length > 0) {
      const gone = new Set(this.gone)
      world.titans = world.titans.filter((t) => !t.netId || !gone.has(t.netId))
      this.gone.length = 0
    }

    if (world.trafficRole !== 'host') return
    // Хозяин: объявить новых (если есть кому смотреть) и снять ушедших.
    if (peerShips.size > 0) {
      for (const t of world.titans) {
        if (t.netId) continue
        const node = push(ref(rtdb, base))
        t.netId = node.key!
        void set(node, {
          p: [t.pos.x + o.x, t.pos.y + o.y, t.pos.z + o.z],
          v: [t.vel.x, t.vel.y, t.vel.z],
          q: [t.quat.x, t.quat.y, t.quat.z, t.quat.w],
          t: serverTimestamp(),
          va: t.variant,
          n: t.name,
          sp: t.spin,
          r: t.radius,
        }).catch(() => {})
      }
    }
    const now = new Set<string>()
    for (const t of world.titans) if (t.netId) now.add(t.netId)
    for (const id of this.alive) if (!now.has(id)) void remove(ref(rtdb, `${base}/${id}`)).catch(() => {})
    this.alive = now
  }

  detach(): void {
    for (const u of this.unsub) u()
    this.unsub = []
    this.key = null
    this.incoming.length = 0
    this.gone.length = 0
    this.alive.clear()
  }

  private attach(key: string): void {
    this.detach()
    this.key = key
    if (!rtdb) return
    const node = ref(rtdb, `traffic/${key}/titans`)
    this.unsub.push(
      onChildAdded(node, (snap) => {
        const v = snap.val() as TitanNode | null
        if (snap.key && v && typeof v.t === 'number') this.incoming.push({ id: snap.key, node: v })
      }),
      onChildRemoved(node, (snap) => {
        if (snap.key) this.gone.push(snap.key)
      }),
    )
  }
}

export const sharedTitans = new SharedTitans()
