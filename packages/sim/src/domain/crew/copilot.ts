import { Vector3 } from 'three'
import { CALENDAR_DAY } from '../../config/contracts'
import { COPILOT, RANK } from '../../config/crew'
import { SHOP } from '../../config/station'
import { clamp } from '../../core/math'
import { autofightActive, disengageAutofight, engageAutofight } from '../ai/autofight'
import { enqueueTask } from '../ai/tasks'
import { isFoe } from '../ai/targeting'
import { createAIState } from '../ai/types'
import { freeCapacity } from '../cargo/hold'
import { isEngageable } from '../combat/engage'
import { moodTo } from '../dialogue/dialogue'
import { allModules, type ShipModule } from '../loadout'
import { hullDamage } from '../station/repair'
import { moduleFault, replaceInstalled, withFault } from '../station/moduleState'
import { rememberPilot } from '../world/acquaintance'
import type { ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'
import type { Persona } from '../world/persona'
import { lockContact } from '../world/queries'
import { beginWarpDeparture } from '../world/warp'
import { rankIndex, rankOfXp, xpForRank } from './rank'

/**
 * ВТОРОЙ ПИЛОТ — бот, приглашённый в кабину игрока. Летает, дерётся и чинит ЗА игрока:
 * автопилот, автобой и ремонт в полёте теперь его руки, а не клавиши J и P.
 *
 * Бортом в мире он не живёт: его корабль уходит, а сам он — запись здесь и знакомство в
 * журнале (говорить с ним можно всегда). Выучка автобоя — ЕГО ранг (`ai.pilotRank`), опыт
 * за общие бои растёт у обоих (`awardKillXp`). Платят ему помесячно, по календарю мира.
 */
export interface Copilot {
  /** Запись знакомства — журнал, отношение, лицо. */
  acquaintanceId: number
  name: string
  persona: Persona
  /** Боевой опыт; ранг из него (`rankOfXp`). */
  xp: number
  /** До какого момента календаря (`world.calendarTime`) жалованье уплачено. */
  paidUntil: number
}

const MONTH = COPILOT.MONTH_DAYS * CALENDAR_DAY

export function copilotRank(copilot: Copilot): number {
  return rankOfXp(copilot.xp)
}

/** Жалованье за игровой месяц по рангу. */
export function copilotSalary(rank: number): number {
  return COPILOT.SALARY[rankIndex(rank)]!
}

// ─── Найм и расчёт ─────────────────────────────────────────────────────────────

/**
 * Почему этот пилот не пойдёт вторым: уже есть свой, это не бот, враг или насторожен,
 * слишком хорош для твоего ранга, нечем заплатить за первый месяц. `null` — пойдёт.
 */
export type HireBlock = 'taken' | 'not-pilot' | 'hostile' | 'wary' | 'rank' | 'money'

export function copilotHireBlock(world: World, ship: ShipEntity): HireBlock | null {
  if (world.copilot) return 'taken'
  if (ship === world.player || ship.divine || ship.mirror || ship.peer || !ship.alive || !ship.ai) return 'not-pilot'
  const mood = moodTo(world, ship)
  if (mood === 'hostile') return 'hostile'
  if (mood === 'wary') return 'wary'
  // Ранг 1 — лучший: «лучше на два ранга» — это число на два меньше.
  if (ship.rank < world.player.rank - COPILOT.HIRE_MARGIN) return 'rank'
  if (world.credits < copilotSalary(ship.rank)) return 'money'
  return null
}

/**
 * Нанять. Первый месяц — вперёд. Борт пилота уходит: у причала — молча, в полёте — прыжком
 * (без привода — тоже молча: свой корабль он отправил на автопилоте к станции).
 */
export function hireCopilot(world: World, ship: ShipEntity): HireBlock | null {
  const block = copilotHireBlock(world, ship)
  if (block) return block
  rememberPilot(world, ship)
  const salary = copilotSalary(ship.rank)
  world.credits -= salary
  world.copilot = {
    acquaintanceId: ship.acquaintanceId!,
    name: ship.pilotName,
    persona: { ...ship.persona },
    xp: xpForRank(ship.rank),
    paidUntil: (Number.isFinite(world.calendarTime) ? world.calendarTime : 0) + MONTH,
  }
  if (ship.ai) ship.ai.escortOf = null
  if (world.docked || ship.ai?.dock === 'berthed' || ship.spec.jumpRange <= 0) ship.warpedOut = true
  else beginWarpDeparture(world, ship)
  return null
}

/** Расчёт: пилот сходит с борта, штурвал — снова твой. */
export function dismissCopilot(world: World): void {
  if (!world.copilot) return
  world.copilot = null
  if (autofightActive(world)) disengageAutofight(world)
  world.helmRequest = 'manual'
}

/**
 * Такт экипажа: второй пилот «летит с тобой» (знакомство — в твоей системе) и раз в месяц
 * просит жалованье. Нечем платить — уходит. После долгой отлучки берёт один месяц: пока
 * тебя не было, он тоже не работал.
 */
export function stepCrew(world: World): void {
  const copilot = world.copilot
  if (!copilot) return
  const record = world.acquaintances.find((a) => a.id === copilot.acquaintanceId)
  if (record) record.systemIndex = world.systemIndex
  const now = world.calendarTime
  if (!Number.isFinite(now) || now < copilot.paidUntil) return
  const salary = copilotSalary(copilotRank(copilot))
  if (world.credits < salary) {
    world.notices.push({ kind: 'copilot-quit', name: copilot.name, at: world.time })
    dismissCopilot(world)
    return
  }
  world.credits -= salary
  copilot.paidUntil = now - copilot.paidUntil > MONTH ? now + MONTH : copilot.paidUntil + MONTH
}

// ─── Штурвал ───────────────────────────────────────────────────────────────────

/** Посадить второго пилота за штурвал игрока (автобой/поручение ведёт `aiController`). */
function takeHelm(world: World, copilot: Copilot): NonNullable<ShipEntity['ai']> {
  const ai = createAIState(world.player.state.pos, world.rng)
  ai.pilotRank = copilotRank(copilot)
  ai.missileCooldown = 0
  world.player.ai = ai
  world.helmRequest = 'manual'
  return ai
}

export type OrderResult = 'ok' | 'no-copilot' | 'docked' | 'no-target' | 'no-foes' | 'no-pods' | 'hold-full'

function ready(world: World): OrderResult | null {
  if (!world.copilot) return 'no-copilot'
  if (world.docked) return 'docked'
  if (!world.player.alive) return 'no-target'
  return null
}

/** Лететь к телу системы (станция, планета, луна, звезда) по его id. */
export function copilotGoto(world: World, bodyId: number): OrderResult {
  const block = ready(world)
  if (block) return block
  if (!world.bodies.some((b) => b.id === bodyId)) return 'no-target'
  if (autofightActive(world)) disengageAutofight(world)
  world.contactLock = null
  world.navTargetId = bodyId
  world.targetFocus = 'nav'
  world.helmRequest = 'flyto'
  return 'ok'
}

/** Кого видно на локаторе второго пилота: живые, видимые, в `SCAN_RANGE`. */
function scanned(world: World, s: ShipEntity): boolean {
  return s.alive && isEngageable(s) && s.state.pos.distanceToSquared(world.player.state.pos) <= COPILOT.SCAN_RANGE ** 2
}

function nearestFoe(world: World): ShipEntity | null {
  let best: ShipEntity | null = null
  let bestD = Infinity
  for (const s of world.ships) {
    if (!scanned(world, s) || !isFoe(world.player, s)) continue
    const d = s.state.pos.distanceToSquared(world.player.state.pos)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

/**
 * В бой: `nearest` — ближайший враг; `all` — враги на локаторе по очереди; число — этот борт
 * (любой видимый: велел бить мирного — бьёт, отвечать за это тебе).
 */
export function copilotAttack(world: World, target: 'nearest' | 'all' | number): OrderResult {
  const block = ready(world)
  if (block) return block
  const copilot = world.copilot!
  const ship = typeof target === 'number' ? world.ships.find((s) => s.id === target) : nearestFoe(world)
  if (!ship || !scanned(world, ship)) return typeof target === 'number' ? 'no-target' : 'no-foes'
  lockContact(world, 'ship', ship.id)
  world.targetFocus = 'contact'
  if (!engageAutofight(world)) return 'no-target'
  const ai = world.player.ai!
  ai.pilotRank = copilotRank(copilot)
  ai.chainFoes = target === 'all'
  world.helmRequest = 'manual'
  return 'ok'
}

/** Собрать контейнеры, что видны на локаторе, пока не кончатся или не забьётся трюм. */
export function copilotCollect(world: World): OrderResult {
  const block = ready(world)
  if (block) return block
  if (freeCapacity(world.player.hold) <= 0) return 'hold-full'
  const pos = world.player.state.pos
  if (!world.pods.some((p) => p.alive && p.pos.distanceToSquared(pos) <= COPILOT.SCAN_RANGE ** 2)) return 'no-pods'
  const ai = takeHelm(world, world.copilot!)
  ai.tasks.length = 0
  enqueueTask(world.player, { kind: 'collect-cargo', anchor: pos.clone(), radius: COPILOT.SCAN_RANGE })
  return 'ok'
}

/** Дальность ухода, м: за кромку локатора, где тебя уже не видят. */
const FLEE_DISTANCE = COPILOT.SCAN_RANGE * 1.5
const _away = new Vector3()

/**
 * «Уходим отсюда»: прочь от врагов на локаторе (нет врагов — по носу) на `FLEE_DISTANCE`.
 * Поручение СРОЧНОЕ — выше боя: пилот не ввязывается в перестрелку по дороге.
 */
export function copilotFlee(world: World): OrderResult {
  const block = ready(world)
  if (block) return block
  const pos = world.player.state.pos
  _away.set(0, 0, 0)
  for (const s of world.ships) {
    if (!scanned(world, s) || !isFoe(world.player, s)) continue
    _away.add(pos).sub(s.state.pos)
  }
  if (_away.lengthSq() < 1e-6) _away.set(0, 0, -1).applyQuaternion(world.player.state.quat)
  _away.normalize().multiplyScalar(FLEE_DISTANCE).add(pos)
  takeHelm(world, world.copilot!)
  enqueueTask(world.player, { kind: 'goto', point: _away.clone(), arriveRadius: 500, urgent: true })
  return 'ok'
}

/** «Стоп» — снять всё: автобой, поручение, автопилот. Штурвал твой. */
export function copilotStop(world: World): OrderResult {
  if (!world.copilot) return 'no-copilot'
  if (autofightActive(world)) disengageAutofight(world)
  world.helmRequest = 'manual'
  return 'ok'
}

// ─── Ремонт в полёте ───────────────────────────────────────────────────────────

/** Скидка к цене мастерской по рангу: новичок `WORST`, ас `BEST`. */
export function copilotRepairDiscount(rank: number): number {
  const t = rankIndex(rank) / (RANK.WORST - RANK.BEST)
  return COPILOT.REPAIR_DISCOUNT_WORST + (COPILOT.REPAIR_DISCOUNT_BEST - COPILOT.REPAIR_DISCOUNT_WORST) * t
}

/** Какую долю поломки закрывает за раз: с `REPAIR_FULL_RANK` — всю. */
export function copilotRepairShare(rank: number): number {
  if (rank <= COPILOT.REPAIR_FULL_RANK) return 1
  const t = clamp((RANK.WORST - rank) / (RANK.WORST - COPILOT.REPAIR_FULL_RANK), 0, 1)
  return COPILOT.REPAIR_QUALITY_WORST + (1 - COPILOT.REPAIR_QUALITY_WORST) * t
}

/** Что чинить: корпус или деталь (модуль на борту игрока). */
export type RepairTarget = { kind: 'hull' } | { kind: 'module'; module: ShipModule }

export interface CopilotRepairQuote {
  /** Цена — только детали: цена мастерской × починенная доля × (1 − скидка). */
  price: number
  /** Доля поломки, что будет закрыта, 0..1. */
  share: number
}

/**
 * Расклад ремонта в полёте. Броска нет: пилот знает свой корабль и не «доламывает», как
 * чужой мастер, — слабый просто не дотягивает до конца. `null` — чинить нечего.
 */
export function copilotRepairQuote(world: World, target: RepairTarget): CopilotRepairQuote | null {
  const copilot = world.copilot
  if (!copilot) return null
  const rank = copilotRank(copilot)
  const share = copilotRepairShare(rank)
  const base =
    target.kind === 'hull'
      ? hullDamage(world.player) * SHOP.HULL_REPAIR_COST
      : target.module.cost * moduleFault(target.module) * SHOP.MODULE_REPAIR_FRACTION
  if (base <= 0) return null
  return { price: Math.ceil(base * share * (1 - copilotRepairDiscount(rank))), share }
}

export type RepairResult = 'repaired' | 'no-copilot' | 'nothing' | 'no-money'

export function copilotRepair(world: World, target: RepairTarget): RepairResult {
  if (!world.copilot) return 'no-copilot'
  const quote = copilotRepairQuote(world, target)
  if (!quote) return 'nothing'
  if (world.credits < quote.price) return 'no-money'
  world.credits -= quote.price
  const player = world.player
  if (target.kind === 'hull') {
    player.hull = Math.min(player.spec.hull.hull, player.hull + hullDamage(player) * quote.share)
    return 'repaired'
  }
  const fault = moduleFault(target.module)
  replaceInstalled(player, target.module, withFault(target.module, -fault * quote.share))
  refreshSpec(player)
  return 'repaired'
}

/** Сломанные детали на борту игрока — в порядке `allModules`. Индекс — ссылка для чата. */
export function brokenModules(world: World): ShipModule[] {
  return allModules(world.player.loadout).filter((m) => moduleFault(m) > 0)
}

/**
 * Починить всё, на что хватит денег: корпус, затем детали по порядку. Сколько вещей
 * починено и сколько потрачено — для ленты.
 */
export function copilotRepairAll(world: World): { fixed: number; spent: number; short: boolean } {
  const before = world.credits
  let fixed = 0
  let short = false
  const targets: RepairTarget[] = [{ kind: 'hull' }, ...brokenModules(world).map((module) => ({ kind: 'module' as const, module }))]
  for (const target of targets) {
    const r = copilotRepair(world, target)
    if (r === 'repaired') fixed++
    else if (r === 'no-money') short = true
  }
  return { fixed, spent: before - world.credits, short }
}
