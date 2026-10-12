import { Quaternion, Vector3 } from 'three'
import {
  adoptShip,
  applyPeerHit,
  captureHandoff,
  findModule,
  isBoundShip,
  isMissile,
  isPersonalShip,
  peerHitYields,
  promoteMirror,
  releaseShip,
  promoteMirrorMissile,
  spawnMirrorMissile,
  spawnMirrorShip,
  yieldLocalTraffic,
  type ContractOffer,
  type MissileEntity,
  type RemoteHit,
  type ShipEntity,
  type ShipHandoff,
  type World,
} from '@elite/sim'
import { currentUserId } from './net/account'
import { rtdb } from './net/firebase'
import { peerShips, peerUidOf } from './net/peers'
import { PoseInterp } from './net/remotePlayers'
import {
  armOwnCleanup,
  claimHost,
  clearHere,
  clearOwn,
  heartbeat,
  hostStale,
  markHere,
  publishFrame,
  publishRosterEntry,
  releaseHost,
  sendBotHit,
  sendClaim,
  sendGrant,
  subscribeBotHits,
  subscribeClaims,
  subscribeFrame,
  subscribeGrants,
  subscribeHere,
  subscribeHost,
  subscribeRoster,
  trafficKey,
  type ClaimRequest,
  type Grant,
  type HostInfo,
} from './net/trafficNet'
import { decodeShip, encodeShip, missileTargetRef, rosterOf, type MissilePose, type RosterEntry, type ShipPose, type TrafficFrame } from './net/trafficWire'

/**
 * ОБЩИЙ МИР: у каждого борта есть ВЛАДЕЛЕЦ-клиент, остальные видят его копию.
 *
 *   • ХОЗЯИН СИСТЕМЫ владеет трафиком (рождает его, гоняет ИИ). Хозяин — тот, чей мир ЖИВЁТ:
 *     пульс идёт только в полёте; пауза, док или разговор — роль через ~4.5 с у другого,
 *     и копии трафика у него ОЖИВАЮТ с того же места (`promoteMirror`), ракеты долетают.
 *   • КАЖДЫЙ ИГРОК владеет своими наёмниками, попутчиками, целями своих дел (`isPersonalShip`)
 *     — их видят все, при любой роли.
 *   • Бот уходит к тому, кто с ним ИМЕЕТ ДЕЛО: заговорил (`engage`) или задел огнём мирного.
 *     Владелец отдаёт его со снимком состояния (`claim`/`grant`), и у нового всё как у хозяина:
 *     нанять, ограбить, взять дело. Кто первым вошёл в систему, на геймплей не влияет.
 *     Не привязанное к игроку (`isBoundShip`) возвращается хозяину, когда мир владельца встал
 *     (док, пауза) или владелец ушёл из системы.
 *
 * Владелец публикует свои борта (реестр — кто, кадр — где), пока в системе есть кому смотреть.
 * Урон по копии уходит владельцу, он применит его у себя (`applyPeerHit`) — бот ответит стрелку.
 * Домен про сеть не знает; здесь — роль, публикация и материализация копий.
 */

/** Кадров в секунду от владельца. Интерполятор рисует на 120 мс в прошлом — чаще не нужно. */
const FRAME_HZ = 10
/** Как часто сверять реестр с миром, с. */
const ROSTER_EVERY = 0.5
/** Пульс хозяина, с. Протухает через `HOST_STALE_MS`. */
const HEARTBEAT_EVERY = 2
/** Как часто пересматривать роль, с. */
const ROLE_EVERY = 1
/**
 * Сколько держать копию трафика, чей владелец пропал, мс. Ушёл прежний хозяин — его узел
 * исчез раньше, чем кто-то успел занять роль; копия ждёт, и новый хозяин её подхватит, а не
 * породит трафик заново.
 */
const ORPHAN_MS = 9000
/** Сколько ждать, пока новый владелец подхватит отданный борт; не подхватил — забрать назад, мс. */
const HANDOFF_MS = 10_000
/** Мир стоит (док, пауза) дольше этого — свободные борта уходят хозяину, мс. */
const IDLE_RELEASE_MS = 5000

const _pos = new Vector3()
const _vel = new Vector3()
const _quat = new Quaternion()

/** Копия чужого борта: чей, под каким id у владельца, какой у меня. */
interface Mirror {
  owner: string
  hid: number
  localId: number
  traffic: boolean
  /** Владелец перестал о ней говорить (мс `performance.now`); null — на связи. */
  orphanSince: number | null
  /** Мой борт, отданный другому: ждёт, пока тот подхватит (мс `performance.now`). */
  handing?: number
}

interface OwnerFeed {
  roster: Record<string, RosterEntry>
  frame: TrafficFrame | null
  unsub: () => void
}

const mirrorKey = (owner: string, hid: number | string): string => `${owner}:${hid}`

export class TrafficSync {
  private key: string | null = null
  private me: string | null = null
  private host: HostInfo | null = null
  private role: 'host' | 'mirror' = 'host'
  private unsub: (() => void)[] = []
  private claiming = false
  /** Кто был хозяином, пока я был зеркалом: его ракеты я подхвачу, став хозяином сам. */
  private formerHost: string | null = null

  /** Что из моего уже в реестре (id → подпись: жив ли и что предлагает). */
  private published = new Map<number, string>()
  private frameAcc = 0
  private rosterAcc = 0
  private beatAcc = 0
  private roleAcc = ROLE_EVERY
  private pendingHits: { hid: number; dmg: number; from: string }[] = []

  /** Чужие владельцы в системе: их реестры и кадры. */
  private feeds = new Map<string, OwnerFeed>()
  private readonly interp = new PoseInterp()
  /** `владелец:id` → копия. */
  private mirrors = new Map<string, Mirror>()
  private missiles = new Map<string, MissileEntity>()
  /** Копии, чью оферту я уже взял или отклонил: из реестра её больше не подставлять. */
  private consumed = new Set<string>()
  /** Кому оферту я подставил: пропала здесь, а у владельца жива — значит отказ или согласие. */
  private offered = new Set<string>()
  /** Кто в системе (`here`); до первого ответа неизвестно — никого не считаем ушедшим. */
  private here: Set<string> | null = null
  /** Бывшие хозяева: uid → когда отдали роль. Их пропавший трафик — сирота, а не убран. */
  private prevHosts = new Map<string, number>()
  /** Просят мои борта; отдали мне борта. */
  private claimsIn: ClaimRequest[] = []
  private grantsIn: Grant[] = []
  /** Мои просьбы: id копии → ждём или отказано. */
  private claimsOut = new Map<number, 'pending' | 'refused'>()
  /** С кем сейчас говорю: его не отдаю. */
  private engagedId: number | null = null
  private idleSince: number | null = null

  /** Кадр. `running` — мир сейчас идёт (не пауза), только тогда можно быть хозяином. */
  tick(world: World, dt: number, running: boolean): void {
    if (!rtdb || !currentUserId()) {
      world.trafficRole = 'host'
      return
    }
    const key = trafficKey(world.galaxySeed, world.systemIndex)
    if (key !== this.key) this.attach(world, key)
    const alive = running && !world.docked

    this.roleAcc += dt
    if (this.roleAcc >= ROLE_EVERY) {
      this.roleAcc = 0
      this.syncFeeds()
      this.decideRole(world, alive)
    }

    if (this.role === 'host' && this.host?.uid === this.me && alive) {
      this.beatAcc += dt
      if (this.beatAcc >= HEARTBEAT_EVERY) {
        this.beatAcc = 0
        void heartbeat(key)
      }
    }

    this.applyHits(world)
    this.serveClaims(world)
    this.releaseIdle(world, alive)
    this.publish(world, dt)
    this.materialize(world)
  }

  /**
   * Открыт разговор с бортом. Свой — помечается взятым (останется у меня, даже если роль хозяина
   * уйдёт); копию — просим у владельца. Пока не отдали, сделки с ней ждут (`acceptBlock`).
   */
  engage(ship: ShipEntity): void {
    this.engagedId = ship.id
    if (ship.divine || ship.peer) return
    if (!ship.mirror) {
      ship.claimed = true
      return
    }
    if (!this.key || this.claimsOut.get(ship.id) === 'pending') return
    for (const m of this.mirrors.values()) {
      if (m.localId !== ship.id) continue
      this.claimsOut.set(ship.id, 'pending')
      void sendClaim(this.key, m.owner, m.hid)
      return
    }
  }

  disengage(): void {
    this.engagedId = null
  }

  /** Действующий хозяин системы (пульс свеж); null — нет или я один. */
  hostUid(): string | null {
    return this.host && !hostStale(this.host) ? this.host.uid : null
  }

  /** Владелец ушёл из системы (или отвалился). До первого списка `here` — никто не ушёл. */
  ownerLeft(uid: string): boolean {
    return this.here != null && !this.here.has(uid)
  }

  /** Владелец только что отдал роль хозяина: брошенный им трафик — сирота, а не убран. */
  ownerYielded(uid: string): boolean {
    const at = this.prevHosts.get(uid)
    return at != null && performance.now() - at < ORPHAN_MS * 2
  }

  /** Его трафик — сирота: ушёл или отдал роль. */
  ownerGone(uid: string): boolean {
    return this.ownerLeft(uid) || this.ownerYielded(uid)
  }

  /** Как идёт просьба отдать копию: ждём, отказано или ничего не просили. */
  claimState(shipId: number): 'pending' | 'refused' | null {
    return this.claimsOut.get(shipId) ?? null
  }

  /** Попадание по копии — её владельцу. true — это была копия, и попадание ушло. */
  forwardHit(hit: RemoteHit): boolean {
    if (!this.key) return false
    for (const m of this.mirrors.values()) {
      if (m.localId !== hit.targetId) continue
      void sendBotHit(this.key, m.owner, m.hid, hit.damage)
      return true
    }
    return false
  }

  /** Уйти из системы (прыжок, размонтирование): отпустить роль, свой узел и подписки. */
  detach(): void {
    for (const u of this.unsub) u()
    this.unsub = []
    for (const f of this.feeds.values()) f.unsub()
    this.feeds.clear()
    if (this.key) {
      if (this.role === 'host') void releaseHost(this.key)
      void clearOwn(this.key)
      void clearHere(this.key)
    }
    this.key = null
    this.host = null
    this.published.clear()
    this.mirrors.clear()
    this.missiles.clear()
    this.pendingHits.length = 0
    this.consumed.clear()
    this.offered.clear()
    this.here = null
    this.prevHosts.clear()
    this.claimsIn.length = 0
    this.grantsIn.length = 0
    this.claimsOut.clear()
    this.idleSince = null
  }

  // ─── Роль ──────────────────────────────────────────────────────────────────

  private attach(world: World, key: string): void {
    this.detach()
    this.key = key
    this.me = currentUserId()
    this.role = 'host'
    world.trafficRole = 'host'
    armOwnCleanup(key)
    markHere(key)
    this.unsub.push(
      subscribeHost(key, (h) => {
        if (this.host && this.host.uid !== h?.uid) this.prevHosts.set(this.host.uid, performance.now())
        this.host = h
      }),
      subscribeHere(key, (uids) => {
        this.here = uids
      }),
      subscribeBotHits(key, (hid, dmg, from) => this.pendingHits.push({ hid, dmg, from })),
      subscribeClaims(key, (req) => this.claimsIn.push(req)),
      subscribeGrants(key, (g) => this.grantsIn.push(g)),
    )
    this.roleAcc = ROLE_EVERY
  }

  /** Подписки — на каждого чужого игрока в системе (и на хозяина, даже если он в доке). */
  private syncFeeds(): void {
    const want = new Set(peerShips.keys())
    if (this.host && this.host.uid !== this.me) want.add(this.host.uid)
    for (const [uid, feed] of this.feeds) {
      if (want.has(uid)) continue
      feed.unsub()
      this.feeds.delete(uid)
    }
    for (const uid of want) {
      if (this.feeds.has(uid) || !this.key) continue
      const feed: OwnerFeed = { roster: {}, frame: null, unsub: () => {} }
      const a = subscribeRoster(this.key, uid, (r) => {
        feed.roster = r
      })
      const b = subscribeFrame(this.key, uid, (f) => {
        feed.frame = f
        if (f) this.ingest(uid, f)
      })
      feed.unsub = () => {
        a()
        b()
      }
      this.feeds.set(uid, feed)
    }
  }

  private decideRole(world: World, alive: boolean): void {
    const h = this.host
    const mine = h?.uid === this.me
    if (!mine && hostStale(h) && alive && !this.claiming && this.key) {
      this.claiming = true
      void claimHost(this.key)
        .then((ok) => {
          if (ok) this.host = { uid: this.me!, t: Date.now() }
        })
        .finally(() => {
          this.claiming = false
        })
    }
    const next: 'host' | 'mirror' = h && !mine && !hostStale(h) ? 'mirror' : 'host'
    if (next === 'mirror' && h) this.formerHost = h.uid
    if (next !== this.role) this.switchRole(world, next)
  }

  private switchRole(world: World, next: 'host' | 'mirror'): void {
    this.role = next
    world.trafficRole = next
    if (next === 'mirror') {
      // Трафик теперь ведёт хозяин — свой уходит, двойников быть не должно. Личное остаётся.
      const removed = new Set(yieldLocalTraffic(world))
      for (const id of removed) this.published.delete(id)
      return
    }
    // Стал хозяином: копии ТРАФИКА оживают с того места и той скоростью, что пришли последними;
    // в реестр они уйдут со ссылкой на прежний ключ — у остальных копия не мигнёт.
    // Только трафик прежнего хозяина: свободные борта гостей ведут гости, пока они здесь.
    for (const [k, m] of [...this.mirrors]) {
      if (!m.traffic || m.owner !== this.formerHost) continue
      const ship = world.ships.find((s) => s.id === m.localId)
      if (ship?.alive) promoteMirror(world, ship, k)
      this.mirrors.delete(k)
      this.interp.drop(k)
    }
    // Ракеты прежнего хозяина долетают сами (личные ракеты игроков ведут их владельцы).
    for (const [k, m] of [...this.missiles]) {
      if (k.split(':')[0] !== this.formerHost) continue
      promoteMirrorMissile(world, m)
      this.missiles.delete(k)
    }
  }

  // ─── Свои борта ────────────────────────────────────────────────────────────

  /** Урон по моим бортам от остальных — в мир, с подписью стрелка. */
  private applyHits(world: World): void {
    for (const h of this.pendingHits) {
      const ship = world.ships.find((s) => s.id === h.hid)
      const attackerId = peerShips.get(h.from)
      const attacker = attackerId != null ? (world.ships.find((s) => s.id === attackerId) ?? null) : null
      if (!ship) continue
      // Задел мирного — мирный уходит к стрелку: обида пойдёт по тем же правилам, что у своего.
      const yields = attacker != null && ship.id !== this.engagedId && peerHitYields(world, ship)
      applyPeerHit(world, ship, h.dmg, attacker, yields)
      if (yields) this.give(world, ship, h.from)
    }
    this.pendingHits.length = 0
  }

  private publish(world: World, dt: number): void {
    // Одному слать некому: реестр и кадры — только когда в системе есть другие.
    if (peerShips.size === 0 || !this.key) return
    this.rosterAcc += dt
    if (this.rosterAcc >= ROSTER_EVERY) {
      this.rosterAcc = 0
      this.syncRoster(world, this.key)
    }
    this.frameAcc += dt
    if (this.frameAcc >= 1 / FRAME_HZ) {
      this.frameAcc = 0
      this.sendFrame(world, this.key)
    }
  }

  /** Моё в реестре: хозяин — весь свой трафик и личное, зеркало — только личное. */
  private owns(world: World, s: ShipEntity): boolean {
    return !s.kinematic && (this.role === 'host' || isPersonalShip(world, s))
  }

  private syncRoster(world: World, key: string): void {
    const seen = new Set<number>()
    for (const s of world.ships) {
      if (!this.owns(world, s)) continue
      seen.add(s.id)
      const sig = `${s.alive ? 1 : 0}|${s.offer ? `${s.offer.kind}:${s.offer.reward}` : ''}`
      if (this.published.get(s.id) === sig) continue
      this.published.set(s.id, sig)
      // Трафик — всё, что не держит игрок: уйдёт владелец — подхватит хозяин, а не потеряет.
      void publishRosterEntry(key, s.id, rosterOf(s, !(isPersonalShip(world, s) && isBoundShip(world, s))))
    }
    // Отданное держим в реестре, пока новый владелец не подхватит: копии у остальных не мигнут.
    for (const m of this.mirrors.values()) if (m.owner === this.me && m.handing != null) seen.add(m.hid)
    for (const id of [...this.published.keys()]) {
      if (seen.has(id)) continue
      this.published.delete(id)
      void publishRosterEntry(key, id, null)
    }
  }

  private sendFrame(world: World, key: string): void {
    const s: Record<string, ShipPose> = {}
    for (const ship of world.ships) {
      if (!ship.alive || !this.published.has(ship.id) || !this.owns(world, ship)) continue
      s[ship.id] = encodeShip(ship, world)
    }
    const m: Record<string, MissilePose> = {}
    const o = world.originOffset
    for (const mi of world.missiles) {
      if (!mi.alive || mi.kinematic) continue
      // Своя ракета — та, что пустил мой борт или я сам.
      if (mi.ownerId !== world.player.id && !this.published.has(mi.ownerId)) continue
      m[mi.id] = {
        p: [mi.pos.x + o.x, mi.pos.y + o.y, mi.pos.z + o.z, mi.vel.x, mi.vel.y, mi.vel.z].map((v) => Math.round(v * 10) / 10),
        mod: mi.module.id,
        to: missileTargetRef(mi.targetId, world, this.me!, (id) => this.refOf(world, id)),
      }
    }
    void publishFrame(key, { s, m })
  }

  /** Как назвать борт для остальных: чужой игрок — по uid, мой — моим id, копия — её владельцем. */
  private refOf(world: World, shipId: number): string | null {
    const uid = peerUidOf(shipId)
    if (uid) return `u:${uid}`
    for (const m of this.mirrors.values()) if (m.localId === shipId) return `h:${mirrorKey(m.owner, m.hid)}`
    return world.ships.some((s) => s.id === shipId) ? `h:${mirrorKey(this.me!, shipId)}` : null
  }

  // ─── Копии чужих ───────────────────────────────────────────────────────────

  private ingest(owner: string, f: TrafficFrame): void {
    const now = performance.now()
    const snaps = []
    for (const [hid, pose] of Object.entries(f.s)) {
      const d = decodeShip(pose)
      if (!d) continue
      snaps.push({ uid: mirrorKey(owner, hid), t: f.t, x: d.x, y: d.y, z: d.z, qx: d.qx, qy: d.qy, qz: d.qz, qw: d.qw, vx: d.vx, vy: d.vy, vz: d.vz, s: d.scale })
    }
    this.interp.ingest(snaps, now)
  }

  private materialize(world: World): void {
    const now = performance.now()
    const o = world.originOffset
    const listed = new Set<string>()

    for (const [owner, feed] of this.feeds) {
      for (const [hidKey, entry] of Object.entries(feed.roster)) {
        const k = mirrorKey(owner, hidKey)
        listed.add(k)
        if (this.mirrors.has(k)) continue
        // Бывшая копия прежнего хозяина: тот же борт, новый владелец — только сменить ключ.
        if (entry.w && this.mirrors.has(entry.w)) {
          const m = this.mirrors.get(entry.w)!
          this.mirrors.delete(entry.w)
          this.mirrors.set(k, { ...m, owner, hid: Number(hidKey), orphanSince: null, traffic: entry.tr === 1, handing: undefined })
          continue
        }
        // Это мой же борт, ушедший к новому хозяину и вернувшийся копией? Нет — свой узел я не читаю.
        if (entry.d) continue
        const raw = feed.frame?.s[hidKey]
        const pose = raw ? decodeShip(raw) : null
        if (!pose) continue
        _pos.set(pose.x - o.x, pose.y - o.y, pose.z - o.z)
        _quat.set(pose.qx, pose.qy, pose.qz, pose.qw)
        const ship = spawnMirrorShip(world, {
          name: entry.n,
          pilotName: entry.pn,
          faction: entry.f,
          originKind: entry.o,
          loadout: entry.l,
          persona: entry.p,
          divine: entry.dv === 1,
          pos: _pos,
          quat: _quat,
        })
        this.mirrors.set(k, { owner, hid: Number(hidKey), localId: ship.id, traffic: entry.tr === 1, orphanSince: null })
      }
    }

    for (const [k, m] of [...this.mirrors]) {
      const ship = world.ships.find((s) => s.id === m.localId)
      if (!ship) {
        this.mirrors.delete(k)
        this.interp.drop(k)
        continue
      }
      const feed = this.feeds.get(m.owner)
      const entry = feed?.roster[String(m.hid)]
      if (m.handing != null) {
        // Мой, отданный: ждёт подхвата. Не подхватили — забираю назад, с той же памятью.
        if (now - m.handing < HANDOFF_MS) continue
        if (ship.alive) promoteMirror(world, ship)
        this.mirrors.delete(k)
        this.interp.drop(k)
        continue
      }
      if (!listed.has(k) || !entry) {
        // Владелец замолчал о борте. Он здесь — значит, убрал сам (прыжок, за горизонт): копия
        // уходит сразу. Ушёл из системы или только что отдал роль хозяина — трафик ждёт
        // подхвата хозяином; привязанное к игроку уходит вместе с ним.
        if (m.traffic && this.ownerGone(m.owner)) {
          m.orphanSince ??= now
          if (this.role === 'host' && this.host?.uid === this.me) {
            if (ship.alive) promoteMirror(world, ship, k)
            this.mirrors.delete(k)
            this.interp.drop(k)
            continue
          }
          if (now - m.orphanSince < ORPHAN_MS) continue
        }
        world.ships = world.ships.filter((s) => s.id !== m.localId)
        this.mirrors.delete(k)
        this.interp.drop(k)
        continue
      }
      m.orphanSince = null
      if (entry.d && ship.alive) {
        ship.alive = false
        ship.mirrorFiring = false
        continue
      }
      if (!ship.alive) continue
      if (this.interp.sample(k, now, _pos, _quat)) {
        ship.state.pos.set(_pos.x - o.x, _pos.y - o.y, _pos.z - o.z)
        ship.state.quat.copy(_quat)
      }
      const raw = feed?.frame?.s[String(m.hid)]
      const pose = raw ? decodeShip(raw) : null
      this.applyOffer(ship, k, m.owner, entry.of)
      if (pose) {
        ship.state.vel.set(pose.vx, pose.vy, pose.vz)
        ship.hull = pose.hull * ship.spec.hull.hull
        ship.shield = pose.shield * ship.spec.hull.shield
        ship.mirrorFiring = pose.firing
        ship.state.scale = pose.scale
      }
    }

    this.syncMissiles(world)
  }

  // ─── Дела у чужих ботов ────────────────────────────────────────────────────

  /**
   * Оферта копии — из реестра владельца. Взятую или отклонённую мной не подставляем снова
   * (владелец снимет её у себя чуть позже). У спасения id нападающих — владельца: переводим
   * в мои копии, иначе дело сочло бы их погибшими и заплатило сразу.
   */
  private applyOffer(ship: ShipEntity, k: string, owner: string, of: ContractOffer | undefined): void {
    // Подставленная оферта пропала у меня — я её взял или отклонил: больше не подставлять.
    if (this.offered.has(k) && !ship.offer) {
      this.offered.delete(k)
      this.consumed.add(k)
    }
    if (!of || this.consumed.has(k)) {
      if (ship.offer && !this.consumed.has(k)) ship.offer = null
      return
    }
    const revealed = ship.offer?.kind === of.kind ? ship.offer.revealed : false
    const offer: ContractOffer = { ...of, revealed }
    if (offer.kind === 'rescue') {
      offer.attackers = offer.attackers
        .map((id) => this.mirrors.get(mirrorKey(owner, id))?.localId)
        .filter((id): id is number => id != null)
    }
    ship.offer = offer
    this.offered.add(k)
  }

  // ─── Передача бортов ───────────────────────────────────────────────────────

  /** Отдать мой борт `to`: здесь он становится копией, туда уходит снимок состояния. */
  private give(world: World, ship: ShipEntity, to: string): void {
    if (!this.key || !this.me) return
    const handoff = captureHandoff(world, ship, (id) => this.refOf(world, id))
    releaseShip(ship)
    this.mirrors.set(mirrorKey(this.me, ship.id), {
      owner: this.me,
      hid: ship.id,
      localId: ship.id,
      traffic: true,
      orphanSince: null,
      handing: performance.now(),
    })
    if (world.offerHailShipId === ship.id) world.offerHailShipId = null
    void sendGrant(this.key, to, ship.id, handoff)
  }

  /** Просьбы отдать мои борта — и борта, отданные мне. */
  private serveClaims(world: World): void {
    if (!this.key) return
    for (const req of this.claimsIn) {
      const ship = world.ships.find((s) => s.id === req.hid && s.alive && !s.kinematic)
      if (ship && ship.id !== this.engagedId && this.owns(world, ship) && !isBoundShip(world, ship)) this.give(world, ship, req.from)
      else void sendGrant(this.key, req.from, req.hid, null)
    }
    this.claimsIn.length = 0

    for (const g of this.grantsIn) {
      const k = mirrorKey(g.from, g.hid)
      const m = this.mirrors.get(k)
      if (!m) continue
      if (!g.h) {
        this.claimsOut.set(m.localId, 'refused')
        continue
      }
      const ship = world.ships.find((s) => s.id === m.localId && s.mirror)
      if (!ship) continue
      let handoff: ShipHandoff
      try {
        handoff = JSON.parse(g.h) as ShipHandoff
      } catch {
        continue
      }
      adoptShip(world, ship, handoff, k, (ref) => this.resolveTarget(world, ref))
      this.mirrors.delete(k)
      this.interp.drop(k)
      this.consumed.delete(k)
      this.offered.delete(k)
      this.claimsOut.delete(ship.id)
    }
    this.grantsIn.length = 0
  }

  /**
   * Мой мир стоит (док, пауза) — свободные борта, кроме собеседника, уходят хозяину: застывший
   * у меня торговец застыл бы и у всех. Привязанные к игроку (наёмник, попутчик) ждут его.
   */
  private releaseIdle(world: World, alive: boolean): void {
    const now = performance.now()
    if (alive) {
      this.idleSince = null
      return
    }
    this.idleSince ??= now
    const h = this.host
    if (now - this.idleSince < IDLE_RELEASE_MS || !h || h.uid === this.me || hostStale(h)) return
    for (const s of [...world.ships]) {
      if (s.kinematic || !s.alive || s.id === this.engagedId) continue
      if (isPersonalShip(world, s) && !isBoundShip(world, s)) this.give(world, s, h.uid)
    }
  }

  /** Ракеты владельцев: видно и тревогу слышно; ведёт и взрывает их владелец. */
  private syncMissiles(world: World): void {
    const o = world.originOffset
    const live = new Set<string>()
    for (const [owner, feed] of this.feeds) {
      for (const [mid, mp] of Object.entries(feed.frame?.m ?? {})) {
        if (!Array.isArray(mp.p) || mp.p.length < 6) continue
        const k = mirrorKey(owner, mid)
        live.add(k)
        _pos.set(mp.p[0]! - o.x, mp.p[1]! - o.y, mp.p[2]! - o.z)
        _vel.set(mp.p[3]!, mp.p[4]!, mp.p[5]!)
        let m = this.missiles.get(k)
        if (!m) {
          const mod = findModule(mp.mod)
          if (!mod || !isMissile(mod)) continue
          m = spawnMirrorMissile(world, mod, -1, this.resolveTarget(world, mp.to), _pos, _vel)
          this.missiles.set(k, m)
        }
        m.pos.copy(_pos)
        m.vel.copy(_vel)
        m.targetId = this.resolveTarget(world, mp.to)
      }
    }
    for (const [k, m] of [...this.missiles]) {
      if (live.has(k)) continue
      // Владелец ракету больше не ведёт: взорвалась у него или он ушёл — гасим копию.
      m.alive = false
      this.missiles.delete(k)
    }
    world.missiles = world.missiles.filter((m) => m.alive || !m.kinematic)
  }

  private resolveTarget(world: World, to: string | null): number | null {
    if (!to) return null
    if (to.startsWith('u:')) {
      const uid = to.slice(2)
      return uid === this.me ? world.player.id : (peerShips.get(uid) ?? null)
    }
    const rest = to.slice(2)
    const [owner, id] = rest.split(':')
    if (owner === this.me) return Number(id)
    return this.mirrors.get(rest)?.localId ?? null
  }
}
