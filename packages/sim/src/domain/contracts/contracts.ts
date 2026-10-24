import { CALENDAR_DAY, CONTRACTS } from '../../config/contracts'
import { hostileToPlayer } from '../ai/targeting'
import { DIALOGUE } from '../../config/dialogue'
import { signed } from '../../core/math'
import { isFoe } from '../ai/targeting'
import { enqueueTask } from '../ai/tasks'
import { addCommodity, freeCapacity } from '../cargo/hold'
import { applyPosture, acquaintanceOf } from '../world/plan'
import { mayHailPlayer, recordEvent, recordJournal, rememberPilot, type Acquaintance, type Relationship } from '../world/acquaintance'
import type { ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'
import { spawnPlatform } from '../world/platforms'
import { spawnBountyPirates } from '../world/traffic'
import { commodityById, rescueOffer } from './offers'
import type { Contract, ContractEnd, ContractOffer, ContractProgress } from './types'

/**
 * ДЕЛА: принять, отказаться, проверить, заплатить. Всё здесь детерминировано и в такте:
 * кость бросается только при рождении оферты (`offers.ts`), а исход дела следует из мира —
 * довёз, убил, снёс, клиент погиб, ушёл из системы.
 */

/** Оферта этого борта, если есть и он жив. */
export function offerOf(ship: ShipEntity): ContractOffer | null {
  return ship.alive ? ship.offer : null
}

/** Активные дела. */
export function activeContracts(world: World): Contract[] {
  return world.contracts.filter((c) => c.status === 'active')
}

/** Почему нельзя взяться прямо сейчас; null — можно. Код, не текст: слова собирает UI. */
export type AcceptBlock = 'no-offer' | 'hold-full' | 'busy' | 'remote'

export function acceptBlock(world: World, ship: ShipEntity): AcceptBlock | null {
  const offer = offerOf(ship)
  if (!offer) return 'no-offer'
  if (offer.kind === 'deliver' && freeCapacity(world.player.hold) < offer.units) return 'hold-full'
  // Копия борта другого клиента: правит им пока он. Разговор уже попросил борт себе
  // (`trafficSync.engage`); как отдадут — дело берётся здесь, как у своего.
  if (ship.mirror) return 'remote'
  // Один заказчик — одно дело: второе от него же, пока первое висит, путает обоих.
  if (activeContracts(world).some((c) => c.giverId === ship.acquaintanceId)) return 'busy'
  return null
}

/** Ступень отношения вверх/вниз: враг → нейтрал → друг. */
function stepRelation(rec: Acquaintance | undefined, delta: 1 | -1): void {
  if (!rec) return
  const ladder: Relationship[] = ['hostile', 'neutral', 'friendly']
  const i = ladder.indexOf(rec.relationship)
  // Фракцию не трогаем: подведённый заказчик тебя не любит, но не стреляет — он не пират.
  rec.relationship = ladder[Math.max(0, Math.min(ladder.length - 1, i + delta))]!
}

const recordOf = (world: World, id: number): Acquaintance | undefined => world.acquaintances.find((a) => a.id === id)

/**
 * Взяться за дело. Заказчик становится знакомым (его можно найти, он помнит уговор);
 * оферта переезжает в карточку; мир готовит цель: груз в трюм, пиратов и гнездо — в систему,
 * клиента — в строй за тобой. Возвращает дело или null, если взяться нельзя.
 */
export function acceptOffer(world: World, ship: ShipEntity): Contract | null {
  if (acceptBlock(world, ship) !== null) return null
  const offer = ship.offer!
  rememberPilot(world, ship)
  const giverId = ship.acquaintanceId!
  const id = world.ids.next()
  const now = world.calendarTime
  const deadline = offer.days != null && Number.isFinite(now) ? now + offer.days * CALENDAR_DAY : null

  let progress: ContractProgress
  switch (offer.kind) {
    case 'deliver': {
      const good = commodityById(offer.commodityId)
      if (good) addCommodity(world.player.hold, good, offer.units)
      refreshSpec(world.player)
      progress = { kind: 'deliver' }
      break
    }
    case 'fetch':
      progress = { kind: 'fetch', delivered: 0 }
      break
    case 'escort': {
      // Клиент встаёт в строй за тобой: попутчик едет через прыжок (`carryFollowersOnJump`).
      const rec = recordOf(world, giverId)!
      rec.plan.patronId = world.player.id
      rec.plan.posture = 'escort'
      rec.roaming = false
      applyPosture(world, rec, ship)
      // Ведёт КЛИЕНТ: позовёт за собой и прыгнет первым (см. `lead-jump`). Задача поручения
      // выше следования за нанимателем, поэтому он сперва ведёт, а там — снова в строю.
      enqueueTask(ship, {
        kind: 'lead-jump',
        toSystem: offer.toSystem,
        toName: offer.toSystemName,
        anchor: ship.state.pos.clone(),
        announceAt: world.time + CONTRACTS.LEAD_ANNOUNCE,
        jumpAt: world.time + CONTRACTS.LEAD_ANNOUNCE + CONTRACTS.LEAD_JUMP,
        announced: false,
      })
      progress = { kind: 'escort' }
      break
    }
    case 'rescue':
      progress = { kind: 'rescue', epoch: world.epoch, clientShipId: ship.id }
      break
    case 'hunt': {
      const targets = spawnBountyPirates(world, offer.heads, id)
      progress = { kind: 'hunt', epoch: world.epoch, targets: targets.map((t) => t.id), resolved: [], kills: 0 }
      break
    }
    case 'demolish': {
      spawnPlatform(world)
      const platform = world.platforms[world.platforms.length - 1]!
      platform.contractId = id
      // Экипаж гнезда — тоже цель дела: держится, пока дело открыто, и ведёт его тот, кто взялся.
      for (const ship of world.ships) if (platform.crew.includes(ship.id)) ship.bountyOf = id
      progress = { kind: 'demolish', epoch: world.epoch, platformId: platform.id }
      break
    }
  }

  const { reward: _r, days: _d, revealed: _v, ...terms } = offer
  const contract: Contract = {
    id,
    terms,
    progress,
    status: 'active',
    end: null,
    giverId,
    giverName: ship.pilotName,
    galaxySeed: world.galaxySeed,
    systemIndex: world.systemIndex,
    systemName: world.systemName,
    issuedAt: now,
    deadline,
    closedAt: null,
    reward: offer.reward,
    paid: 0,
  }
  world.contracts.push(contract)
  // Уговор — в общую память: без этого бот знал о деле, лишь пока оно активно, а закрытое
  // (перебили пиратов, ушёл из системы) забывал начисто — «знать не знаю ни о какой миссии».
  const giver = recordOf(world, giverId)
  if (giver) recordJournal(world, giver, { kind: 'job', job: terms.kind, outcome: 'taken', paid: 0 })
  ship.offer = null
  if (world.offerHailShipId === ship.id) world.offerHailShipId = null
  recordEvent(world, ship, { kind: 'asked', topic: 'job', agreed: true })
  return contract
}

/** Как заказчик принял отказ. */
export type DeclineMood = 'shrug' | 'angry'

/**
 * Отказаться. Оферта гаснет. За «не повезу товар» поймут; за «не помогу с пиратами» вспыльчивый
 * обидится — дела, где речь о жизни, отказом не отмахиваются (`docs/PLAN_contracts.md`, п. 14).
 */
export function declineOffer(world: World, ship: ShipEntity): DeclineMood {
  const offer = ship.offer
  ship.offer = null
  if (world.offerHailShipId === ship.id) world.offerHailShipId = null
  if (!offer) return 'shrug'
  recordEvent(world, ship, { kind: 'asked', topic: 'job', agreed: false })
  const vital = offer.kind === 'rescue' || offer.kind === 'hunt' || offer.kind === 'demolish'
  if (vital && ship.persona.temperament >= 4) {
    stepRelation(recordOf(world, ship.acquaintanceId ?? -1), -1)
    return 'angry'
  }
  return 'shrug'
}

/** Игрок слышал оферту (спросил «есть работа?» или ответил на вызов). */
export function revealOffer(world: World, ship: ShipEntity): ContractOffer | null {
  const offer = offerOf(ship)
  if (offer) offer.revealed = true
  if (world.offerHailShipId === ship.id) world.offerHailShipId = null
  return offer
}

// ─── Закрытие ────────────────────────────────────────────────────────────────────

/** Закрыть дело. Плата уже начислена тем, кто закрывает; тут — статус, отношение, весть. */
function close(world: World, c: Contract, status: 'done' | 'failed', end: ContractEnd): void {
  c.status = status
  c.end = end
  c.closedAt = world.calendarTime
  const rec = recordOf(world, c.giverId)
  if (rec) recordJournal(world, rec, { kind: 'job', job: c.terms.kind, outcome: end, paid: c.paid })
  if (status === 'done') stepRelation(rec, 1)
  // Подвёл — минус ступень. Но не за то, в чём не виноват: клиент погиб, цель ушла сама.
  else if (end === 'expired' || end === 'abandoned') stepRelation(rec, -1)
  // Попутчик отпущен: дело кончилось, он больше не идёт за тобой.
  if (c.terms.kind === 'escort' && rec) {
    rec.plan.patronId = null
    rec.plan.posture = 'idle'
    rec.roaming = true
    const ship = world.ships.find((s) => s.acquaintanceId === rec.id)
    if (ship?.ai) ship.ai.escortOf = null
  }
  world.notices.push({
    kind: status === 'done' ? 'contract-done' : 'contract-failed',
    name: c.giverName,
    other: c.terms.kind,
    amount: c.paid,
    at: world.time,
  })
  trimHistory(world)
}

function pay(world: World, c: Contract, amount: number): void {
  if (amount <= 0) return
  world.credits += amount
  c.paid += amount
}

/** Закрытые дела держим в списке недолго: экрану «ДЕЛА» нужна свежая история, не архив. */
function trimHistory(world: World): void {
  const closed = world.contracts.filter((c) => c.status !== 'active')
  const excess = closed.length - CONTRACTS.HISTORY
  if (excess <= 0) return
  const drop = new Set(closed.slice(0, excess))
  world.contracts = world.contracts.filter((c) => !drop.has(c))
}

// ─── Такт ────────────────────────────────────────────────────────────────────────

/**
 * Ход дел — в такте мира, не в кадре. Проверяет цели в мире, сроки и уход из системы;
 * ведёт вызовы по связи с офертами; на стыковке — сдача груза и доставка клиента.
 */
export function stepContracts(world: World, dt: number): void {
  for (const c of world.contracts) if (c.status === 'active') checkContract(world, c)
  if (world.docked) {
    if (!world.contractsDockSettled) {
      settleAtDock(world)
      world.contractsDockSettled = true
    }
  } else world.contractsDockSettled = false
  // Не хозяин: зов о помощи создаёт хозяин (у него бой); здесь — только позвать по связи,
  // если копия бота пришла уже с ним. Вызов с обычным делом — по сроку, как у всех.
  if (world.trafficRole === 'mirror') stepMirrorRescueHails(world)
  else stepRescueCalls(world)
  stepOfferHail(world, dt)
}

function checkContract(world: World, c: Contract): void {
  const now = world.calendarTime
  if (c.deadline != null && Number.isFinite(now) && now > c.deadline) {
    const p = c.progress
    if (p.kind === 'fetch' && p.delivered > 0) close(world, c, 'done', 'partial')
    else close(world, c, 'failed', 'expired')
    return
  }
  // Дело взято в другой галактике — тот же номер системы здесь чужой: дело гаснет.
  if (c.galaxySeed !== world.galaxySeed) {
    close(world, c, 'failed', 'abandoned')
    return
  }

  const p = c.progress
  switch (p.kind) {
    case 'deliver':
    case 'fetch':
      return
    case 'escort': {
      const rec = recordOf(world, c.giverId)
      if (!rec?.alive) close(world, c, 'failed', 'client-lost')
      return
    }
    case 'rescue': {
      if (p.epoch !== world.epoch) return close(world, c, 'failed', 'abandoned')
      const client = world.ships.find((s) => s.id === p.clientShipId)
      if (!client?.alive) return close(world, c, 'failed', 'client-lost')
      const terms = c.terms.kind === 'rescue' ? c.terms : null
      const left = terms?.attackers.some((id) => world.ships.some((s) => s.id === id && s.alive && !s.warpDeparting))
      if (!left) {
        pay(world, c, c.reward)
        close(world, c, 'done', 'completed')
      }
      return
    }
    case 'hunt': {
      if (p.epoch !== world.epoch) return close(world, c, 'failed', 'abandoned')
      for (const id of p.targets) {
        if (p.resolved.includes(id)) continue
        const ship = world.ships.find((s) => s.id === id)
        if (ship && ship.alive && !ship.warpDeparting) continue
        p.resolved.push(id)
        // Засчитывается только СВОЁ: добил ты или твой наёмник. Ушёл прыжком — премии нет.
        if (ship && !ship.alive && killedByPlayerSide(world, ship)) {
          p.kills += 1
          pay(world, c, c.reward)
        }
      }
      if (p.resolved.length === p.targets.length) {
        const all = p.kills === p.targets.length
        close(world, c, p.kills > 0 ? 'done' : 'failed', all ? 'completed' : p.kills > 0 ? 'partial' : 'empty')
      }
      return
    }
    case 'demolish': {
      if (p.epoch !== world.epoch) return close(world, c, 'failed', 'abandoned')
      const platform = world.platforms.find((x) => x.id === p.platformId)
      if (!platform || !platform.alive) {
        // Разрушение платят ЦЕЛИКОМ: смысл заказа — чтобы гнездо взорвалось.
        pay(world, c, c.reward)
        close(world, c, 'done', 'completed')
      }
      return
    }
  }
}

function killedByPlayerSide(world: World, ship: ShipEntity): boolean {
  const by = ship.lastAttackerId
  if (by == null) return false
  if (by === world.player.id) return true
  return world.ships.some((s) => s.id === by && s.ai?.escortOf === world.player.id)
}

/**
 * Сдача на стыковке: доставка в системе назначения, «привези» — частями, попутчик — довезён.
 * Раз на стыковку (`contractsDockSettled`), а не каждый такт у причала.
 */
function settleAtDock(world: World): void {
  const hold = world.player.hold
  for (const c of activeContracts(world)) {
    const t = c.terms
    if (t.kind === 'deliver' && world.systemIndex === t.toSystem) {
      if (takeFromHold(world, t.commodityId, t.units, true) === t.units) {
        pay(world, c, c.reward)
        close(world, c, 'done', 'completed')
      }
    } else if (t.kind === 'fetch' && world.systemIndex === c.systemIndex && c.progress.kind === 'fetch') {
      const p = c.progress
      const got = takeFromHold(world, t.commodityId, t.units - p.delivered, false)
      if (got > 0) {
        // Приёмка по частям: платят за сданное, как за банду — по головам.
        p.delivered += got
        pay(world, c, got * c.reward)
        if (p.delivered >= t.units) close(world, c, 'done', 'completed')
      }
    } else if (t.kind === 'escort' && world.systemIndex === t.toSystem) {
      const rec = recordOf(world, c.giverId)
      if (rec?.alive && rec.systemIndex === world.systemIndex) {
        pay(world, c, c.reward)
        close(world, c, 'done', 'completed')
      }
    }
  }
  refreshSpec(world.player)
  void hold
}

/**
 * Снять из трюма до `units` единиц товара. `whole` — только всю партию разом (доставка), иначе
 * сколько есть (приёмка частями). Возвращает, сколько снято.
 */
function takeFromHold(world: World, commodityId: string, units: number, whole: boolean): number {
  const items = world.player.hold.items
  let have = 0
  for (const it of items) if (it.kind === 'commodity' && it.commodity.id === commodityId) have += it.units
  const take = whole ? (have >= units ? units : 0) : Math.min(have, units)
  let left = take
  for (const it of items) {
    if (left <= 0) break
    if (it.kind !== 'commodity' || it.commodity.id !== commodityId) continue
    const d = Math.min(it.units, left)
    it.units -= d
    left -= d
  }
  world.player.hold.items = items.filter((it) => it.kind !== 'commodity' || it.units > 0)
  return take
}

// ─── Вызовы по связи ─────────────────────────────────────────────────────────────

/**
 * Борт с офертой, который сейчас вызывает игрока. Вызов по связи — сам заговорил:
 * плашка на HUD, T отвечает (как на обиду).
 */
export function offerHail(world: World): ShipEntity | null {
  const id = world.offerHailShipId
  if (id == null) return null
  const ship = world.ships.find((s) => s.id === id)
  if (!ship?.alive || !ship.offer || world.time - world.offerHailAt > CONTRACTS.HAIL_LIFE) {
    world.offerHailShipId = null
    return null
  }
  return ship
}

function hail(world: World, ship: ShipEntity): void {
  world.offerHailShipId = ship.id
  world.offerHailAt = world.time
}

/** Ближайший к игроку борт с ещё не услышанной офертой в пределах связи. */
function hailCandidate(world: World): ShipEntity | null {
  let best: ShipEntity | null = null
  let bestD: number = DIALOGUE.RANGE
  for (const s of world.ships) {
    if (!s.alive || !s.offer || s.offer.revealed || hostileToPlayer(world, s) || s.warpDeparting) continue
    if (!mayHailPlayer(s)) continue
    const d = s.state.pos.distanceTo(world.player.state.pos)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

/**
 * Сами заговаривают по СРОКУ, а не броском в такте: таймер в секундах, первый — в первую
 * минуту, дальше — раз в ~15 минут. Нет никого рядом — попробовать чуть позже.
 */
function stepOfferHail(world: World, dt: number): void {
  if (world.docked) return
  world.offerHailTimer -= dt
  if (world.offerHailTimer > 0) return
  if (offerHail(world)) {
    world.offerHailTimer = CONTRACTS.HAIL_RETRY
    return
  }
  const ship = hailCandidate(world)
  if (!ship) {
    world.offerHailTimer = CONTRACTS.HAIL_RETRY
    return
  }
  hail(world, ship)
  world.offerHailTimer = CONTRACTS.HAIL_INTERVAL * (1 + signed(world.rng) * CONTRACTS.HAIL_JITTER)
}

/**
 * Зов о помощи: на мирного напали, игрок рядом — он вызывает сам, вне очереди и срока.
 * Один раз на борт: отказал — второй раз не просит.
 */
function stepRescueCalls(world: World): void {
  if (world.docked) return
  for (const s of world.ships) {
    if (!s.alive || s.faction !== 'neutral' || !s.ai || s.rescueAsked || s.divine) continue
    if (s.ai.foes.length === 0) continue
    // Звать есть кого: ты или другой живой игрок рядом (его зов дойдёт с копией борта).
    if (!humanNear(world, s)) continue
    const attackers = world.ships.filter((o) => o.alive && o.faction === 'hostile' && isFoe(s, o))
    if (attackers.length === 0) continue
    s.rescueAsked = true
    s.offer = rescueOffer(attackers)
    hail(world, s)
  }
}

/** Есть ли рядом живой игрок — ты или чужой (`peer`). */
function humanNear(world: World, s: ShipEntity): boolean {
  if (s.state.pos.distanceTo(world.player.state.pos) <= DIALOGUE.RANGE) return true
  return world.ships.some((o) => o.peer && o.alive && o.state.pos.distanceTo(s.state.pos) <= DIALOGUE.RANGE)
}

/** Не хозяин: копия бота пришла с зовом о помощи — позвать по связи, раз на борт. */
function stepMirrorRescueHails(world: World): void {
  if (world.docked) return
  for (const s of world.ships) {
    if (!s.mirror || !s.alive || s.rescueAsked || s.offer?.kind !== 'rescue') continue
    if (s.state.pos.distanceTo(world.player.state.pos) > DIALOGUE.RANGE) continue
    s.rescueAsked = true
    hail(world, s)
  }
}

/** Знакомый-заказчик, если есть запись. Для экрана «ДЕЛА». */
export function contractGiver(world: World, c: Contract): Acquaintance | null {
  return recordOf(world, c.giverId) ?? null
}

/** Дела, которые переживают прыжок и сейв: те, что не привязаны к целям в этой системе. */
export function isPortable(c: Contract): boolean {
  return c.terms.kind === 'deliver' || c.terms.kind === 'fetch' || c.terms.kind === 'escort'
}

export { acquaintanceOf }
