import { Quaternion, Vector3 } from 'three'
import { onChildAdded, onValue, push, ref, remove, set } from 'firebase/database'
import {
  applyStructHitAtHost,
  killWarBaseFixture,
  promoteMirrorPlatform,
  spawnMirrorPlatform,
  type PlatformEntity,
  type StructHit,
  type World,
} from '@elite/sim'
import { currentUserId } from './net/account'
import { rtdb } from './net/firebase'
import { peerShips } from './net/peers'
import { trafficKey } from './net/trafficNet'

/**
 * ОБЩИЕ СООРУЖЕНИЯ: военные базы и пиратские гнёзда. Колет их хозяин системы — у остальных
 * удар уходит ему (`world.structHits`), гибель детали и прочность гнезда приходят от него.
 *
 *   bases — по номеру базы строка живых деталей («1101…»): базы ставятся от зерна системы,
 *           и у всех они одни и в одном порядке, поэтому слать нужно лишь, что погибло;
 *   plats — гнёзда: место, облик, прочность, жив ли. Ключ — сетевой (`владелец:id`), он
 *           переживает смену хозяина: новый просто продолжает писать под тем же ключом.
 */

interface PlatNode {
  p: number[]
  q: number[]
  va: number
  h: number
  mh: number
  a: 0 | 1
}

/** Как часто хозяин сверяет сооружения, с. Гибель детали — событие редкое, гнать её чаще незачем. */
const SYNC_EVERY = 0.5

const _pos = new Vector3()
const _quat = new Quaternion()

const mask = (alive: readonly { alive: boolean }[]): string => alive.map((f) => (f.alive ? '1' : '0')).join('')

export class SharedStructs {
  private key: string | null = null
  private me: string | null = null
  private unsub: (() => void)[] = []
  private isHost = false
  private acc = 0
  private bases: Record<string, string> = {}
  private plats: Record<string, PlatNode> = {}
  private hits: StructHit[] = []
  /** Что я уже опубликовал (хозяином): базы и гнёзда по ключу. */
  private sentBases = new Map<number, string>()
  private sentPlats = new Map<string, string>()

  tick(world: World, dt: number): void {
    if (!rtdb || !currentUserId()) {
      world.structHits.length = 0
      return
    }
    const key = trafficKey(world.galaxySeed, world.systemIndex)
    if (key !== this.key) this.attach(key)
    const host = world.trafficRole === 'host'
    if (host && !this.isHost) this.becomeHost(world)
    this.isHost = host

    if (host) {
      for (const h of this.hits) applyStructHitAtHost(world, h)
      this.hits.length = 0
      this.acc += dt
      if (this.acc >= SYNC_EVERY && peerShips.size > 0) {
        this.acc = 0
        this.publish(world, key)
      }
    } else {
      for (const h of world.structHits) void push(ref(rtdb, `traffic/${key}/structhits`), { ...h, from: this.me }).catch(() => {})
      this.applyBases(world)
      this.applyPlats(world)
    }
    world.structHits.length = 0
  }

  detach(): void {
    for (const u of this.unsub) u()
    this.unsub = []
    this.key = null
    this.bases = {}
    this.plats = {}
    this.hits.length = 0
    this.sentBases.clear()
    this.sentPlats.clear()
    this.isHost = false
  }

  private attach(key: string): void {
    this.detach()
    this.key = key
    this.me = currentUserId()
    if (!rtdb) return
    this.unsub.push(
      onValue(ref(rtdb, `traffic/${key}/bases`), (s) => {
        this.bases = (s.val() ?? {}) as Record<string, string>
      }, () => {}),
      onValue(ref(rtdb, `traffic/${key}/plats`), (s) => {
        this.plats = (s.val() ?? {}) as Record<string, PlatNode>
      }, () => {}),
      onChildAdded(ref(rtdb, `traffic/${key}/structhits`), (snap) => {
        // Удар нужен только хозяину: забирает тот, кто колет.
        if (!this.isHost) return
        const v = snap.val() as (StructHit & { from?: string }) | null
        void remove(snap.ref).catch(() => {})
        if (v && (v.kind === 'fixture' || v.kind === 'platform')) this.hits.push(v)
      }),
    )
  }

  /** Стал хозяином: копии гнёзд становятся настоящими; базы уже свои (они от зерна). */
  private becomeHost(world: World): void {
    for (const p of world.platforms) if (p.kinematic) promoteMirrorPlatform(p)
  }

  private publish(world: World, key: string): void {
    world.warBases.forEach((b, i) => {
      const m = mask(b.fixtures)
      if (this.sentBases.get(i) === m) return
      this.sentBases.set(i, m)
      void set(ref(rtdb!, `traffic/${key}/bases/${i}`), m).catch(() => {})
    })
    const o = world.originOffset
    const seen = new Set<string>()
    for (const p of world.platforms) {
      if (p.kinematic) continue
      p.netId ??= `${this.me}:${p.id}`
      seen.add(p.netId)
      const node: PlatNode = {
        p: [p.pos.x + o.x, p.pos.y + o.y, p.pos.z + o.z].map((v) => Math.round(v * 10) / 10),
        q: [p.quat.x, p.quat.y, p.quat.z, p.quat.w].map((v) => Math.round(v * 1000) / 1000),
        va: p.variant,
        h: Math.round(p.hull),
        mh: p.maxHull,
        a: p.alive ? 1 : 0,
      }
      const sig = `${node.h}|${node.a}`
      if (this.sentPlats.get(p.netId) === sig) continue
      this.sentPlats.set(p.netId, sig)
      void set(ref(rtdb!, `traffic/${key}/plats/${p.netId}`), node).catch(() => {})
    }
    for (const id of [...this.sentPlats.keys()]) {
      if (seen.has(id)) continue
      this.sentPlats.delete(id)
      void set(ref(rtdb!, `traffic/${key}/plats/${id}`), null).catch(() => {})
    }
  }

  /** Погибшие у хозяина детали — погасить здесь (база рухнет сама, если деталь последняя). */
  private applyBases(world: World): void {
    for (const [index, m] of Object.entries(this.bases)) {
      const base = world.warBases[Number(index)]
      if (!base || typeof m !== 'string') continue
      base.fixtures.forEach((fix, j) => {
        if (m[j] === '0' && fix.alive) killWarBaseFixture(world, base, fix)
      })
    }
  }

  private applyPlats(world: World): void {
    const o = world.originOffset
    for (const [netId, node] of Object.entries(this.plats)) {
      let p: PlatformEntity | undefined = world.platforms.find((x) => x.netId === netId)
      if (!p) {
        if (!node.a || !Array.isArray(node.p) || !Array.isArray(node.q)) continue
        _pos.set(node.p[0]! - o.x, node.p[1]! - o.y, node.p[2]! - o.z)
        _quat.set(node.q[0]!, node.q[1]!, node.q[2]!, node.q[3]!)
        p = spawnMirrorPlatform(world, { netId, variant: node.va, pos: _pos, quat: _quat, hull: node.h, maxHull: node.mh })
      }
      if (!p.kinematic) continue
      p.hull = node.a ? node.h : 0
    }
    // Хозяин убрал гнездо (за горизонт, после взрыва) — уходит и копия.
    world.platforms = world.platforms.filter((p) => !p.kinematic || !p.netId || p.netId in this.plats || !p.alive)
  }
}

export const sharedStructs = new SharedStructs()
