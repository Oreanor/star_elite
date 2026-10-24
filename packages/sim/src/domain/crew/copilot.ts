import { Vector3 } from 'three'
import { CALENDAR_DAY } from '../../config/contracts'
import { COPILOT, RANK } from '../../config/crew'
import { SHOP } from '../../config/station'
import { clamp, makeRng } from '../../core/math'
import { autofightActive, disengageAutofight, engageAutofight } from '../ai/autofight'
import { enqueueTask, type Task } from '../ai/tasks'
import { isFoe } from '../ai/targeting'
import { createAIState } from '../ai/types'
import { freeCapacity } from '../cargo/hold'
import { isEngageable } from '../combat/engage'
import { moodTo } from '../dialogue/dialogue'
import { allModules, type ShipModule } from '../loadout'
import { hullDamage } from '../station/repair'
import { hashModuleId, moduleFault, replaceInstalled, withFault } from '../station/moduleState'
import { rememberPilot } from '../world/acquaintance'
import type { ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'
import type { Persona } from '../world/persona'
import { findNavByName, lockContact, navTarget } from '../world/queries'
import { jumpBlock } from '../galaxy/jump'
import { flyToLocalTarget } from '../flight/flyto'
import { beginWarpDeparture } from '../world/warp'
import { spawnResidentContacts } from '../world/traffic'
import { rankIndex, rankOfXp, xpForRank } from './rank'

/**
 * ВТОРОЙ ПИЛОТ — бот, приглашённый в кабину игрока. Летает, дерётся и чинит за игрока.
 * J при нём на борту: одно нажатие — автопилот к цели (и в клубке), двойное — автобой.
 * Бить нечего — двойное просто летит туда же. Любое следующее J отдаёт штурвал.
 * P — связь с ним, остальные приказы словами. Без него J молчит.
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
  /**
   * Когда (`world.time`) он переспросил «точно списываешь?». Расчёт — только вторым словом:
   * модель путала «отбой» (снять приказ) с увольнением, и пилот молча сходил с борта.
   */
  dismissAskedAt?: number
}

/** Сколько секунд мира живёт вопрос «точно списываешь?» — дальше снова переспросит. */
const DISMISS_CONFIRM_WINDOW = 120

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

/**
 * Просьба о расчёте. Первая — только вопрос (`'ask'`): «точно?». Повтор в окне
 * `DISMISS_CONFIRM_WINDOW` — расчёт (`'done'`).
 */
export function requestDismiss(world: World): 'ask' | 'done' | null {
  const copilot = world.copilot
  if (!copilot) return null
  const asked = copilot.dismissAskedAt
  if (asked === undefined || world.time - asked > DISMISS_CONFIRM_WINDOW || world.time < asked) {
    copilot.dismissAskedAt = world.time
    return 'ask'
  }
  dismissCopilot(world)
  return 'done'
}

/**
 * Расчёт: пилот сходит с борта, штурвал — снова твой. Он не растворяется: вызывает свой
 * корабль и остаётся в системе знакомым — передумал, позови снова.
 */
export function dismissCopilot(world: World): void {
  if (!world.copilot) return
  world.copilot = null
  if (autofightActive(world)) disengageAutofight(world)
  world.helmRequest = 'manual'
  spawnResidentContacts(world)
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

export type OrderResult = 'ok' | 'no-copilot' | 'docked' | 'no-target' | 'no-foes' | 'no-pods' | 'hold-full' | 'no-jump'

function ready(world: World): OrderResult | null {
  if (!world.copilot) return 'no-copilot'
  if (world.docked) return 'docked'
  if (!world.player.alive) return 'no-target'
  return null
}

/**
 * Лететь к цели системы по id: тело (станция, планета, луна, звезда), статуя, монолит,
 * военная база — всё, к чему ведёт автопилот (`navTarget`).
 */
export function copilotGoto(world: World, bodyId: number): OrderResult {
  const block = ready(world)
  if (block) return block
  const before = world.navTargetId
  world.navTargetId = bodyId
  if (!navTarget(world)) {
    world.navTargetId = before
    return 'no-target'
  }
  if (autofightActive(world)) disengageAutofight(world)
  world.contactLock = null
  world.targetFocus = 'nav'
  // Звезда галактики, выбранная на карте, перебивает цель в системе (`flyto.destination`).
  world.jumpTargetIndex = null
  world.helmRequest = 'flyto'
  return 'ok'
}

/**
 * Подлететь к БОРТУ в системе — любому видимому, не только на локаторе: «найди торговца и
 * лети к нему». Тот же полёт-к-цели, цель — захваченный корабль (едет — догоняем).
 */
export function copilotApproach(world: World, shipId: number): OrderResult {
  const block = ready(world)
  if (block) return block
  const ship = world.ships.find((s) => s.id === shipId)
  if (!ship || !ship.alive || ship.cloaked) return 'no-target'
  if (autofightActive(world)) disengageAutofight(world)
  lockContact(world, 'ship', ship.id)
  world.targetFocus = 'contact'
  world.jumpTargetIndex = null
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
  // Названный борт — где угодно в системе (пилот догонит); «ближайший» и «все» — с локатора.
  const ship = typeof target === 'number' ? world.ships.find((s) => s.id === target) : nearestFoe(world)
  if (!ship || !ship.alive || !isEngageable(ship)) return typeof target === 'number' ? 'no-target' : 'no-foes'
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

/**
 * J по МАРШРУТУ С КАРТЫ: выбрана звезда, а в системе цели нет — второй пилот не ползёт к ней
 * сквозь межзвёздную пустоту автопилотом, а прыгает (тот же рейс, что «летим туда»), выходя у
 * причала, выбранного на карте. null — маршрута нет, или в системе есть цель (её ведёт J
 * обычным автопилотом). Гиганту прыжок недоступен — его ведёт полёт по галактике.
 */
export function copilotJumpRoute(world: World): OrderResult | null {
  const system = world.jumpTargetIndex
  if (system == null || system === world.systemIndex || !world.copilot) return null
  if (world.player.state.scale !== 1 || flyToLocalTarget(world)) return null
  const result = copilotTravel(world, system, null)
  if (result === 'ok' && world.tripRequest && world.tripRequest !== 'cancel') {
    world.tripRequest.arrivalPlanet = world.jumpArrivalPlanet
  }
  return result
}

/** «Стоп» — снять всё: автобой, поручение, автопилот, рейс. Штурвал твой. */
export function copilotStop(world: World): OrderResult {
  if (!world.copilot) return 'no-copilot'
  if (autofightActive(world)) disengageAutofight(world)
  world.helmRequest = 'manual'
  world.tripRequest = 'cancel'
  return 'ok'
}

/**
 * РЕЙС: «летим туда» — в систему `system` и к цели `target` в ней (по имени: планета, станция,
 * статуя, база; null — к причалу). В этой же системе в полёте — просто курс на цель; у причала —
 * тот же рейс без кольца (отчалить, отойти, курс). В другую —
 * просьба к слою приложения (`tripRequest`): он отчалит, отойдёт, встанет, раскроет кольцо,
 * войдёт и возьмёт курс на цель уже там. Док и крейсер рейсу не помеха — пилот с них сойдёт
 * сам; не пускают привод, заряд и дальность — об этом и скажет.
 */
export function copilotTravel(world: World, system: number, target: string | null): OrderResult {
  if (!world.copilot) return 'no-copilot'
  if (!world.player.alive) return 'no-target'
  if (system === world.systemIndex && !world.docked) {
    const id = target ? findNavByName(world, target) : (world.bodies.find((b) => b.kind === 'station')?.id ?? null)
    return id === null ? 'no-target' : copilotGoto(world, id)
  }
  const blocked = jumpBlock(world, system)
  if (blocked !== null && blocked !== 'docked' && blocked !== 'cruising') return 'no-jump'
  if (autofightActive(world)) disengageAutofight(world)
  world.tripRequest = { system, target }
  return 'ok'
}

/**
 * Рейс ведёт ВТОРОЙ ПИЛОТ одной задачей за раз: режиссёр рейса (клиент — кольцо прыжка живёт
 * там) меняет её по фазам — отойти от причала, встать, войти в кольцо. Срочная: по дороге в
 * бой не ввязывается. false — вести нечем (нет пилота, корабль погиб или в доке).
 */
export function copilotSteer(world: World, task: Task): boolean {
  if (!world.copilot || !world.player.alive || world.docked) return false
  const ai = world.player.ai ?? takeHelm(world, world.copilot)
  ai.tasks.length = 0
  ai.tasks.push({ ...task, urgent: true })
  return true
}

// ─── Ремонт в полёте ───────────────────────────────────────────────────────────

/** Скидка к цене мастерской по рангу: новичок `WORST`, ас `BEST`. */
export function copilotRepairDiscount(rank: number): number {
  const t = rankIndex(rank) / (RANK.WORST - RANK.BEST)
  return COPILOT.REPAIR_DISCOUNT_WORST + (COPILOT.REPAIR_DISCOUNT_BEST - COPILOT.REPAIR_DISCOUNT_WORST) * t
}

/** Шанс починить начисто за подход: новичок `REPAIR_LUCK_WORST`, с `REPAIR_FULL_RANK` — всегда. */
export function copilotRepairLuck(rank: number): number {
  if (rank <= COPILOT.REPAIR_FULL_RANK) return 1
  const t = clamp((RANK.WORST - rank) / (RANK.WORST - COPILOT.REPAIR_FULL_RANK), 0, 1)
  return COPILOT.REPAIR_LUCK_WORST + (1 - COPILOT.REPAIR_LUCK_WORST) * t
}

/** Что чинить: корпус или деталь (модуль на борту игрока). */
export type RepairTarget = { kind: 'hull' } | { kind: 'module'; module: ShipModule }

export interface CopilotRepairQuote {
  /** Цена ПОЛНОЙ починки — только детали: цена мастерской × (1 − скидка). Не дочинил — дешевле. */
  price: number
  /** Поломка сейчас, доля 0..1. */
  before: number
  /** Шанс, что этот подход доведёт до нуля. */
  luck: number
}

/** Поломка цели долей: у корпуса — недостающая доля прочности, у детали — её `fault`. */
function faultOf(world: World, target: RepairTarget): number {
  if (target.kind === 'module') return moduleFault(target.module)
  const max = world.player.spec.hull.hull
  return max > 0 ? hullDamage(world.player) / max : 0
}

/** Цена починки доли `amount` поломки цели, со скидкой второго пилота. */
function partsPrice(world: World, target: RepairTarget, amount: number, rank: number): number {
  const full =
    target.kind === 'hull'
      ? world.player.spec.hull.hull * SHOP.HULL_REPAIR_COST
      : target.module.cost * SHOP.MODULE_REPAIR_FRACTION
  return Math.ceil(full * amount * (1 - copilotRepairDiscount(rank)))
}

/** Расклад ремонта в полёте. `null` — чинить нечего. */
export function copilotRepairQuote(world: World, target: RepairTarget): CopilotRepairQuote | null {
  const copilot = world.copilot
  if (!copilot) return null
  const before = faultOf(world, target)
  if (before <= 1e-6) return null
  const rank = copilotRank(copilot)
  const luck = before <= COPILOT.REPAIR_SURE_BELOW ? 1 : copilotRepairLuck(rank)
  return { price: partsPrice(world, target, before, rank), before, luck }
}

export type RepairResult = 'repaired' | 'partial' | 'no-copilot' | 'nothing' | 'no-money'

export interface CopilotRepairOutcome {
  result: RepairResult
  /** Списано, кр. */
  spent: number
  /** Поломка после подхода, доля 0..1. */
  left: number
}

/**
 * Подход к ремонту. Бросок детерминирован (зерно галактики, система, цель, текущая поломка —
 * `Math.random` под запретом ради сети) и меняется от подхода к подходу: поломка другая.
 * Денег должно хватать на полную починку — сколько выйдет, заранее не знает и пилот.
 */
export function copilotRepair(world: World, target: RepairTarget): CopilotRepairOutcome {
  if (!world.copilot) return { result: 'no-copilot', spent: 0, left: 0 }
  const quote = copilotRepairQuote(world, target)
  if (!quote) return { result: 'nothing', spent: 0, left: 0 }
  if (world.credits < quote.price) return { result: 'no-money', spent: 0, left: quote.before }
  const rng = makeRng(
    world.galaxySeed ^
      Math.imul(world.systemIndex + 1, 0x9e3779b1) ^
      Math.imul(Math.round(quote.before * 10_000), 0x85ebca6b) ^
      Math.imul(target.kind === 'hull' ? 1 : hashModuleId(target.module.id), 0x27d4eb2f),
  )
  const clean = rng() < quote.luck
  const [lo, hi] = COPILOT.REPAIR_LEFT
  const left = clean ? 0 : quote.before * (lo + (hi - lo) * rng())
  const spent = partsPrice(world, target, quote.before - left, copilotRank(world.copilot))
  world.credits -= spent
  const player = world.player
  if (target.kind === 'hull') {
    player.hull = player.spec.hull.hull * (1 - left)
  } else {
    replaceInstalled(player, target.module, withFault(target.module, left - quote.before))
    refreshSpec(player)
  }
  return { result: clean ? 'repaired' : 'partial', spent, left }
}

/** Сломанные детали на борту игрока — в порядке `allModules`. Индекс — ссылка для чата. */
export function brokenModules(world: World): ShipModule[] {
  return allModules(world.player.loadout).filter((m) => moduleFault(m) > 0)
}

/**
 * Починить всё, на что хватит денег: корпус, затем детали по порядку. Сколько вещей
 * починено и сколько потрачено — для ленты.
 */
export function copilotRepairAll(world: World): { fixed: number; spent: number; short: boolean; partial: boolean } {
  const before = world.credits
  let fixed = 0
  let short = false
  let partial = false
  const targets: RepairTarget[] = [{ kind: 'hull' }, ...brokenModules(world).map((module) => ({ kind: 'module' as const, module }))]
  for (const target of targets) {
    const r = copilotRepair(world, target).result
    if (r === 'repaired' || r === 'partial') fixed++
    if (r === 'partial') partial = true
    else if (r === 'no-money') short = true
  }
  return { fixed, spent: before - world.credits, short, partial }
}
