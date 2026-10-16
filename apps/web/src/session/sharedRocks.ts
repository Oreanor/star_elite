import { Vector3 } from 'three'
import {
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  push,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from 'firebase/database'
import { applyRockHit, dropNetRock, revokeScoop, spawnNetRock, type World } from '@elite/sim'
import { currentUserId } from './net/account'
import { rtdb, serverNow } from './net/firebase'
import { peerShips } from './net/peers'
import { trafficKey } from './net/trafficNet'

/**
 * ОБЩИЕ КАМНИ. Пояс и встречные глыбы у всех одни: хозяин системы объявляет каждый камень
 * (точка, скорость, момент, радиус, форма), дрейф прямой — у всех он в том же месте. Колет
 * ТОЛЬКО хозяин: удар у остальных уходит ему (`world.rockHits`), он раскалывает и объявляет
 * осколки; расколотый исчезает у всех. Мелкий камень черпают, как контейнер: кто первый.
 *
 * Узел — `traffic/{система}/rocks` (камни) и `rockhits` (удары для хозяина). Он не принадлежит
 * хозяину: сменился хозяин — камни остались, новый просто продолжает колоть.
 */

interface RockNode {
  p: number[]
  v: number[]
  t: number
  r: number
  sh: number
  /** Поколение раскола: без него осколок у нового хозяина снова кололся бы как целый камень. */
  g?: number
  taken?: string
}

const _pos = new Vector3()
const _vel = new Vector3()

export class SharedRocks {
  private key: string | null = null
  private me: string | null = null
  private unsub: (() => void)[] = []
  private incoming: { id: string; node: RockNode }[] = []
  private gone: { id: string; burst: boolean }[] = []
  private hits: { id: string; dmg: number; bomb: boolean; blast: boolean }[] = []
  /** Ключи камней, живых в мире на прошлом кадре. У хозяина пропажа = раскол/уход → снять узел. */
  private alive = new Set<string>()
  private wasHost = false
  /** Хозяин ли я прямо сейчас — для колбэка ударов: забирает удар только тот, кто колет. */
  private isHost = false

  tick(world: World): void {
    if (!rtdb || !currentUserId()) {
      world.rockHits.length = 0
      world.rockClaims.length = 0
      return
    }
    const key = trafficKey(world.galaxySeed, world.systemIndex)
    if (key !== this.key) this.attach(key)
    const base = `traffic/${key}/rocks`
    const host = world.trafficRole === 'host'
    this.isHost = host
    const o = world.originOffset

    // Стал хозяином пустой системы — чужие узлы прошлых сессий не правда: стереть и объявить своё.
    if (host && !this.wasHost && peerShips.size === 0) {
      void set(ref(rtdb, base), null).catch(() => {})
      for (const a of world.asteroids) a.netId = undefined
      this.alive.clear()
    }
    this.wasHost = host

    // 1) Чужие объявленные — в мир.
    for (const { id, node } of this.incoming) {
      if (node.taken || world.asteroids.some((a) => a.netId === id)) continue
      if (!Array.isArray(node.p) || !Array.isArray(node.v) || node.p.length < 3 || node.v.length < 3) continue
      const age = Math.max(0, (serverNow() - node.t) / 1000)
      _vel.set(node.v[0]!, node.v[1]!, node.v[2]!)
      _pos.set(node.p[0]! - o.x, node.p[1]! - o.y, node.p[2]! - o.z).addScaledVector(_vel, age)
      spawnNetRock(world, id, _pos, _vel, node.r, node.sh, typeof node.g === 'number' ? node.g : 0)
    }
    this.incoming.length = 0

    // 2) Расколотые/зачерпнутые где-то ещё — убрать здесь.
    for (const { id, burst } of this.gone) dropNetRock(world, id, burst)
    this.gone.length = 0

    if (host) {
      // 3) Хозяин: удары от остальных — колоть у себя.
      for (const h of this.hits) applyRockHit(world, h.id, h.dmg, h.bomb, h.blast)
      this.hits.length = 0

      // 4) Объявить новые свои камни (пояс, встречи, осколки) — одной записью. Одному незачем.
      if (peerShips.size > 0) {
        const batch: Record<string, unknown> = {}
        for (const a of world.asteroids) {
          if (!a.alive || a.netId) continue
          a.netId = push(ref(rtdb, base)).key!
          batch[a.netId] = {
            p: [a.pos.x + o.x, a.pos.y + o.y, a.pos.z + o.z].map((v) => Math.round(v * 10) / 10),
            v: [a.vel.x, a.vel.y, a.vel.z].map((v) => Math.round(v * 100) / 100),
            t: serverTimestamp(),
            r: a.radius,
            sh: a.shape,
            g: a.gen ?? 0,
          }
        }
        if (Object.keys(batch).length > 0) void update(ref(rtdb, base), batch).catch(() => {})
      }

      // 5) Пропавшие у хозяина (раскол, уход за горизонт) — снять узел у всех.
      const now = new Set<string>()
      for (const a of world.asteroids) if (a.alive && a.netId) now.add(a.netId)
      for (const id of this.alive) if (!now.has(id)) void remove(ref(rtdb, `${base}/${id}`)).catch(() => {})
      this.alive = now
    } else {
      // Не хозяин: удары — хозяину. Свои пропажи узлов не трогают: колет не он.
      for (const h of world.rockHits) {
        void push(ref(rtdb, `traffic/${key}/rockhits`), { rid: h.netId, dmg: h.damage, b: h.bomb ? 1 : h.blast ? 2 : 0, from: this.me }).catch(() => {})
      }
      this.alive.clear()
      for (const a of world.asteroids) if (a.alive && a.netId) this.alive.add(a.netId)
    }
    world.rockHits.length = 0

    // 6) Зачерпнутые — подтвердить у сервера; кто не успел, руда уходит обратно.
    for (const claim of world.rockClaims) {
      const node = ref(rtdb, `${base}/${claim.netId}`)
      const me = this.me!
      this.alive.delete(claim.netId)
      void runTransaction(node, (cur: RockNode | null) => {
        if (cur == null) return cur
        if (cur.taken) return undefined
        return { ...cur, taken: me }
      })
        .then((res) => {
          const v = res.snapshot.val() as RockNode | null
          if (res.committed && v?.taken === me) {
            void remove(node).catch(() => {})
            return
          }
          if (v?.taken && v.taken !== me) revokeScoop(world, claim.shipId, claim.item)
        })
        .catch(() => {})
    }
    world.rockClaims.length = 0
  }

  detach(): void {
    for (const u of this.unsub) u()
    this.unsub = []
    this.key = null
    this.incoming.length = 0
    this.gone.length = 0
    this.hits.length = 0
    this.alive.clear()
    this.wasHost = false
  }

  private attach(key: string): void {
    this.detach()
    this.key = key
    this.me = currentUserId()
    if (!rtdb) return
    const rocks = ref(rtdb, `traffic/${key}/rocks`)
    this.unsub.push(
      onChildAdded(rocks, (snap) => {
        const v = snap.val() as RockNode | null
        if (snap.key && v && typeof v.t === 'number') this.incoming.push({ id: snap.key, node: v })
      }),
      onChildChanged(rocks, (snap) => {
        const v = snap.val() as RockNode | null
        if (snap.key && v?.taken && v.taken !== this.me) this.gone.push({ id: snap.key, burst: false })
      }),
      onChildRemoved(rocks, (snap) => {
        const v = snap.val() as RockNode | null
        if (snap.key) this.gone.push({ id: snap.key, burst: !v?.taken })
      }),
      onChildAdded(ref(rtdb, `traffic/${key}/rockhits`), (snap) => {
        const v = snap.val() as { rid?: string; dmg?: number; b?: number } | null
        // Удары нужны только хозяину; не хозяин их не трогает — заберёт тот, кто колет.
        if (!this.isHost || !snap.key || !v || typeof v.rid !== 'string' || typeof v.dmg !== 'number') return
        // b: 1 — бомба (надвое), 2 — военный лазер (сразу в пыль), иначе обычный удар.
        this.hits.push({ id: v.rid, dmg: v.dmg, bomb: v.b === 1, blast: v.b === 2 })
        void remove(snap.ref).catch(() => {})
      }),
    )
  }
}

export const sharedRocks = new SharedRocks()
