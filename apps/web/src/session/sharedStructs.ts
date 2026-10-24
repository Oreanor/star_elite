import { Quaternion, Vector3 } from 'three'
import { onChildAdded, onValue, push, ref, remove, set } from 'firebase/database'
import {
  applyStructHitAtHost,
  killWarBaseFixture,
  shatterWarBase,
  promoteMirrorPlatform,
  spawnMirrorPlatform,
  type PlatformEntity,
  type StructHit,
  type WarBaseEntity,
  type World,
} from '@elite/sim'
import { currentUserId } from './net/account'
import { rtdb } from './net/firebase'
import { peerShips } from './net/peers'
import { trafficKey } from './net/trafficNet'
import { trafficSync } from './sharedTraffic'

/**
 * ОБЩИЕ СООРУЖЕНИЯ: военные базы и пиратские гнёзда.
 *
 *   bases — по номеру базы строка живых деталей («1101…»). Базы ставятся от зерна системы, у всех
 *           они одни и в одном порядке, поэтому слать нужно лишь, что погибло. Колет их хозяин.
 *   plats — гнёзда: место, облик, прочность, жив ли, чьё (`o`). У гнезда, как у борта, свой
 *           владелец: обычное — хозяина системы, гнездо под заказ на снос — того, кто взялся.
 *           Ключ сетевой (`владелец:id`) и переживает смену владельца: ушёл прежний — хозяин
 *           подхватывает гнездо и пишет под тем же ключом.
 *
 * Удар по чужому — владельцу в ящик `structhits/{uid}`: деталь базы — хозяину, гнездо — его хозяину.
 */

interface PlatNode {
  p: number[]
  q: number[]
  va: number
  h: number
  mh: number
  a: 0 | 1
  /** Владелец. */
  o: string
  /** Под заказ на снос: держит владелец дела и при смене хозяина системы. */
  c?: 1
}

/** Как часто сверять сооружения, с. Гибель детали — событие редкое, гнать её чаще незачем. */
const SYNC_EVERY = 0.5

const _pos = new Vector3()
const _quat = new Quaternion()

const mask = (alive: readonly { alive: boolean }[]): string => alive.map((f) => (f.alive ? '1' : '0')).join('')
/**
 * Маска базы для рассылки: живые детали, а снесённая ШАРОМ — с меткой `X` впереди. Такую базу
 * у остальных надо рвать так же (очаги и общий взрыв), а не каскадом по сбитой последней детали.
 */
const baseMask = (b: WarBaseEntity): string => (b.violent ? 'X' : '') + mask(b.fixtures)

/** Владелец гнезда: из узла, а у старого узла без поля — из ключа. */
const ownerOf = (netId: string, node?: PlatNode): string => node?.o ?? netId.slice(0, netId.indexOf(':'))

export class SharedStructs {
  private key: string | null = null
  private me: string | null = null
  private unsub: (() => void)[] = []
  private isHost = false
  private acc = 0
  private bases: Record<string, string> = {}
  private plats: Record<string, PlatNode> = {}
  private hits: StructHit[] = []
  /** Что я уже опубликовал: базы (хозяином) и свои гнёзда по ключу. */
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
    // Отдал роль: обычные гнёзда ушли к хозяину вместе с трафиком — их узлы теперь его, не стирать.
    if (!host && this.isHost) this.sentPlats.clear()
    this.isHost = host

    for (const h of this.hits) applyStructHitAtHost(world, h)
    this.hits.length = 0
    for (const h of world.structHits) {
      const to = h.kind === 'platform' ? ownerOf(h.netId, this.plats[h.netId]) : trafficSync.hostUid()
      if (to && to !== this.me) void push(ref(rtdb, `traffic/${key}/structhits/${to}`), { ...h, from: this.me }).catch(() => {})
    }
    world.structHits.length = 0

    if (!host) this.applyBases(world)
    this.applyPlats(world, host)
    this.acc += dt
    if (this.acc >= SYNC_EVERY && peerShips.size > 0) {
      this.acc = 0
      this.publish(world, key, host)
    }
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
      onChildAdded(ref(rtdb, `traffic/${key}/structhits/${this.me}`), (snap) => {
        const v = snap.val() as (StructHit & { from?: string }) | null
        void remove(snap.ref).catch(() => {})
        if (v && (v.kind === 'fixture' || v.kind === 'platform' || v.kind === 'shatter')) this.hits.push(v)
      }),
    )
  }

  private publish(world: World, key: string, host: boolean): void {
    if (host) {
      // Ключ — место базы в описании системы (`slot`), не номер в списке: снесённую выносят.
      for (const b of world.warBases) {
        const m = baseMask(b)
        if (this.sentBases.get(b.slot) === m) continue
        this.sentBases.set(b.slot, m)
        void set(ref(rtdb!, `traffic/${key}/bases/${b.slot}`), m).catch(() => {})
      }
    }
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
        o: this.me!,
      }
      if (p.contractId != null) node.c = 1
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
      const base = world.warBases.find((b) => b.slot === Number(index))
      if (!base || typeof m !== 'string') continue
      if (m.startsWith('X')) {
        shatterWarBase(world, base)
        continue
      }
      base.fixtures.forEach((fix, j) => {
        if (m[j] === '0' && fix.alive) killWarBaseFixture(world, base, fix)
      })
    }
  }

  private applyPlats(world: World, host: boolean): void {
    const o = world.originOffset
    for (const [netId, node] of Object.entries(this.plats)) {
      const owner = ownerOf(netId, node)
      if (owner === this.me) continue
      let p: PlatformEntity | undefined = world.platforms.find((x) => x.netId === netId)
      if (!p) {
        if (!node.a || !Array.isArray(node.p) || !Array.isArray(node.q)) continue
        _pos.set(node.p[0]! - o.x, node.p[1]! - o.y, node.p[2]! - o.z)
        _quat.set(node.q[0]!, node.q[1]!, node.q[2]!, node.q[3]!)
        p = spawnMirrorPlatform(world, { netId, variant: node.va, pos: _pos, quat: _quat, hull: node.h, maxHull: node.mh })
      }
      if (!p.kinematic) continue
      p.hull = node.a ? node.h : 0
      // Владелец ушёл — живое гнездо подхватывает хозяин, под тем же ключом. Отдал роль — только
      // обычное: гнездо под заказом остаётся у него.
      const orphan = trafficSync.ownerLeft(owner) || (!node.c && trafficSync.ownerYielded(owner))
      if (host && node.a && orphan) promoteMirrorPlatform(p)
    }
    // Владелец убрал гнездо (за горизонт, после взрыва) — уходит и копия.
    world.platforms = world.platforms.filter((p) => !p.kinematic || !p.netId || p.netId in this.plats || !p.alive)
  }
}

export const sharedStructs = new SharedStructs()
