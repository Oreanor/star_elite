import { MODULE_CATALOGUE, findModule } from '../../config/modules'
import { CONTACTS } from '../../config/contacts'
import { DIALOGUE } from '../../config/dialogue'
import { createAIState } from '../ai/types'
import type { SavedLoadout } from '../save/player'
import { rehydrateLoadout, serializeLoadout } from '../save/player'
import {
  canBuy,
  priceOf,
  resaleOf,
  stationStock,
  type PurchaseError,
} from '../station/shop'
import { isWeapon, type ShipModule } from '../loadout'
import { refreshSpec } from './factory'
import type { Acquaintance } from './acquaintance'
import { sendContactTo } from './acquaintance'
import type { ContactPlan, PlanStep, RawPlanStep } from './contactPlan'
import { emptyPlan } from './contactPlan'
import type { ShipEntity, World } from './entities'
import { distanceLy, placeSystem } from '../galaxy/shape'

/**
 * Исполнение плана знакомого: немедленно в мире и отложенно за кулисами.
 *
 * Журнал — память. План — очередь + posture. Любая макро-команда из диалога
 * компилируется сюда и переживает прыжки.
 */

export function acquaintanceOf(world: World, ship: ShipEntity): Acquaintance | null {
  if (ship.acquaintanceId == null) return null
  return world.acquaintances.find((a) => a.id === ship.acquaintanceId) ?? null
}

/** Стартовый кошелёк при первом знакомстве. */
export function initialContactCredits(world: World): number {
  return 4_000 + Math.floor(world.rng() * 10_000)
}

function firstGunOnLoadout(loadout: ShipEntity['loadout']): number | undefined {
  const hp = loadout.chassis.hardpoints
  for (let i = 0; i < hp.length; i++) if (hp[i]?.kind === 'gun') return i
  return undefined
}
export function syncContactFromShip(record: Acquaintance, ship: ShipEntity): void {
  record.savedLoadout = serializeLoadout(ship.loadout)
}

export function syncLiveContactsFromShips(world: World): void {
  for (const ship of world.ships) {
    if (!ship.alive || ship.acquaintanceId == null) continue
    const rec = world.acquaintances.find((a) => a.id === ship.acquaintanceId)
    if (!rec) continue
    rec.savedLoadout = serializeLoadout(ship.loadout)
    rec.systemIndex = world.systemIndex
  }
}

/** Наложить сохранённую сборку и posture на воссозданный борт. */
export function rehydrateContactShip(world: World, record: Acquaintance, ship: ShipEntity): void {
  if (record.savedLoadout) {
    try {
      ship.loadout = rehydrateLoadout(record.savedLoadout)
      refreshSpec(ship)
    } catch {
      // битый сейв — оставляем spawn loadout
    }
  }
  applyPosture(world, record, ship)
}

export function applyPosture(world: World, record: Acquaintance, ship: ShipEntity): void {
  if (record.plan.posture === 'idle' || record.plan.patronId == null) return
  ship.ai ??= createAIState(ship.state.pos, world.rng)
  ship.ai.escortOf = record.plan.patronId
  ship.ai.command = 'default'
  ship.ai.skill = Math.max(ship.ai.skill, DIALOGUE.ESCORT_SKILL)
  ship.ai.targetId = null
  ship.ai.orderedTargetId = null
}

/** Разрешить id модуля: точный id или единственное совпадение по подстроке. */
export function resolveModuleId(raw: string): string | null {
  const t = raw.trim().toLowerCase()
  if (!t) return null
  const exact = findModule(t)
  if (exact) return exact.id
  const byId = MODULE_CATALOGUE.filter((m) => m.id.toLowerCase().includes(t))
  if (byId.length === 1) return byId[0]!.id
  const byName = MODULE_CATALOGUE.filter((m) => m.name.toLowerCase().includes(t))
  if (byName.length === 1) return byName[0]!.id
  return null
}

function firstGunHardpoint(ship: ShipEntity): number | undefined {
  const hp = ship.loadout.chassis.hardpoints
  for (let i = 0; i < hp.length; i++) if (hp[i]?.kind === 'gun') return i
  return undefined
}

/** Скомпилировать шаги из речи игрока / JSON модели. */
export function compileRawPlan(
  raw: readonly RawPlanStep[],
  world: World,
  ship: ShipEntity,
  patronId: number,
): ContactPlan {
  const plan = emptyPlan()
  const steps: PlanStep[] = []

  for (const r of raw) {
    if (r.step === 'dock') steps.push({ kind: 'dock' })
    else if (r.step === 'undock') steps.push({ kind: 'undock' })
    else if (r.step === 'buy') {
      const moduleId = resolveModuleId(r.module)
      if (moduleId) steps.push({ kind: 'buy', moduleId, hardpoint: r.hardpoint })
    } else if (r.step === 'goto-system' && typeof r.systemIndex === 'number') {
      steps.push({ kind: 'goto-system', systemIndex: r.systemIndex })
    } else if (r.step === 'escort') {
      plan.patronId = patronId
      plan.posture = r.cover ? 'cover' : 'escort'
    }
  }

  const station = world.bodies.some((b) => b.kind === 'station')
  const berthed = ship.ai?.dock === 'berthed'
  const needsDock = steps.some((s) => s.kind === 'buy') && station && !berthed
  if (needsDock && !steps.some((s) => s.kind === 'dock')) steps.unshift({ kind: 'dock' })
  if (steps.some((s) => s.kind === 'buy') && !steps.some((s) => s.kind === 'undock')) {
    steps.push({ kind: 'undock' })
  }
  if (plan.posture !== 'idle' && !steps.some((s) => s.kind === 'join')) {
    steps.push({ kind: 'join', patronId })
  }

  plan.queue = steps
  return plan
}

export function mergePlan(record: Acquaintance, compiled: ContactPlan): void {
  record.plan.queue.push(...compiled.queue)
  if (compiled.posture !== 'idle') {
    record.plan.posture = compiled.posture
    record.plan.patronId = compiled.patronId
  }
}

function contactBuy(
  world: World,
  record: Acquaintance,
  ship: ShipEntity,
  module: ShipModule,
  hardpoint?: number,
): PurchaseError | null {
  const purse = record.credits
  const saved = world.credits
  world.credits = purse
  const err = canBuy(world, ship, module, hardpoint)
  if (err) {
    world.credits = saved
    return err
  }
  world.credits -= priceOf(module)
  if (isWeapon(module) && hardpoint !== undefined) {
    const previous = ship.loadout.weapons[hardpoint]
    if (previous) world.credits += resaleOf(previous)
    ship.loadout.weapons[hardpoint] = module
  } else {
    const installed = ship.loadout.internals.filter((m) => m.kind === module.kind)
    const slots = ship.loadout.chassis.slots.filter((s) => s.kind === module.kind).length
    if (installed.length >= slots) {
      const worst = installed.reduce((a, b) => (a.cost <= b.cost ? a : b))
      ship.loadout.internals.splice(ship.loadout.internals.indexOf(worst), 1)
      world.credits += resaleOf(worst)
    }
    ship.loadout.internals.push(module)
  }
  record.credits = world.credits
  world.credits = saved
  refreshSpec(ship)
  record.savedLoadout = serializeLoadout(ship.loadout)
  return null
}

function abstractBuy(world: World, record: Acquaintance, moduleId: string): boolean {
  const module = findModule(moduleId)
  if (!module) return false
  const savedIndex = world.systemIndex
  world.systemIndex = record.systemIndex
  let ok = false
  try {
    const stock = stationStock(world)
    if (!stock.some((m) => m.id === moduleId)) return false
    const cost = priceOf(module)
    if (record.credits < cost) return false
    record.credits -= cost
    const saved: SavedLoadout = record.savedLoadout ?? {
      chassis: record.chassisId,
      internals: [],
      weapons: [],
    }
    const loadout = rehydrateLoadout(saved)
    if (isWeapon(module)) {
      const hi = firstGunOnLoadout(loadout)
      if (hi === undefined) return false
      loadout.weapons[hi] = module
    } else {
      loadout.internals.push(module)
    }
    record.savedLoadout = serializeLoadout(loadout)
    ok = true
  } catch {
    ok = false
  } finally {
    world.systemIndex = savedIndex
  }
  return ok
}

function runPlanStep(world: World, record: Acquaintance, ship: ShipEntity, step: PlanStep): boolean {
  const station = world.bodies.find((b) => b.kind === 'station')

  switch (step.kind) {
    case 'dock': {
      if (!station || !ship.ai) return false
      if (ship.ai.dock === 'berthed') return true
      if (ship.ai.dock == null) ship.ai.dock = 'inbound'
      return false
    }
    case 'buy': {
      if (ship.ai?.dock !== 'berthed') return false
      const module = findModule(step.moduleId)
      if (!module) return true
      const hp = step.hardpoint ?? (isWeapon(module) ? firstGunHardpoint(ship) : undefined)
      const err = contactBuy(world, record, ship, module, hp)
      return err == null
    }
    case 'undock': {
      if (!ship.ai) return true
      if (ship.ai.dock === 'berthed' || ship.ai.dock === 'inbound') {
        ship.ai.dock = 'done'
        ship.controls.throttle = 0.65
      }
      return true
    }
    case 'goto-system': {
      sendContactTo(record, step.systemIndex)
      return record.systemIndex === step.systemIndex || record.boundFor == null
    }
    case 'join': {
      ship.ai ??= createAIState(ship.state.pos, world.rng)
      ship.ai.escortOf = step.patronId
      ship.ai.command = 'default'
      record.plan.patronId = step.patronId
      return true
    }
  }
}

/** Исполнить сколько можно прямо сейчас; вернуть строки для ленты. */
export function advanceContactPlan(world: World, ship: ShipEntity): string[] {
  const record = acquaintanceOf(world, ship)
  if (!record) return []
  const lines: string[] = []

  while (record.plan.queue.length > 0) {
    const head = record.plan.queue[0]!
    const done = runPlanStep(world, record, ship, head)
    if (!done) break
    record.plan.queue.shift()
    if (head.kind === 'buy') lines.push(`Установлен модуль: ${head.moduleId}.`)
    if (head.kind === 'join') lines.push('Встаю в сопровождение.')
    if (head.kind === 'undock') lines.push('Отчаливаю от причала.')
  }

  if (record.plan.queue.length === 0) applyPosture(world, record, ship)
  syncContactFromShip(record, ship)
  return lines
}

/** Один шаг плана за прыжок игрока для контакта вне поля зрения. */
export function stepContactPlanOffScreen(world: World, record: Acquaintance): void {
  if (record.plan.queue.length === 0) return
  const head = record.plan.queue[0]!

  if (head.kind === 'buy') {
    if (abstractBuy(world, record, head.moduleId)) record.plan.queue.shift()
    return
  }
  if (head.kind === 'goto-system') {
    sendContactTo(record, head.systemIndex)
    if (record.boundFor == null) record.plan.queue.shift()
    return
  }
  if (head.kind === 'dock' || head.kind === 'undock' || head.kind === 'join') {
    record.plan.queue.shift()
    stepContactPlanOffScreen(world, record)
  }
}

/** Применить макро-план из диалога. */
export function applyContactPlan(
  world: World,
  ship: ShipEntity,
  raw: readonly RawPlanStep[],
): { lines: string[]; accepted: boolean } {
  const record = acquaintanceOf(world, ship)
  if (!record || raw.length === 0) return { lines: [], accepted: false }

  const compiled = compileRawPlan(raw, world, ship, world.player.id)
  if (compiled.queue.length === 0 && compiled.posture === 'idle') {
    return { lines: [], accepted: false }
  }

  mergePlan(record, compiled)
  const lines = advanceContactPlan(world, ship)
  return { lines, accepted: true }
}

/**
 * Пилот: план с приоритетом над tasks. true — этот такт занят планом (док/покупка).
 */
export function flyContactPlan(e: ShipEntity, world: World): boolean {
  const record = acquaintanceOf(world, e)
  if (!record || record.plan.queue.length === 0) return false
  const head = record.plan.queue[0]!
  if (head.kind !== 'dock') return false
  if (!e.ai) return false
  if (e.ai.dock == null) e.ai.dock = 'inbound'
  advanceContactPlan(world, e)
  return e.ai.dock !== 'berthed'
}

/** Сколько прыжков игрока нужно контакту, чтобы долететь из одной системы в другую. */
export function contactEtaHops(fromSystemIndex: number, toSystemIndex: number, galaxySeed: number): number {
  if (fromSystemIndex === toSystemIndex) return 0
  const from = placeSystem(fromSystemIndex, galaxySeed)
  const to = placeSystem(toSystemIndex, galaxySeed)
  const dist = distanceLy(from, to)
  return Math.max(1, Math.ceil(dist / CONTACTS.WANDER_RANGE_LY))
}

/** ETA к цели перелёта (`boundFor`) или первому `goto-system` в очереди плана. */
export function contactTravelEta(record: Acquaintance, galaxySeed: number): number | null {
  const dest =
    record.boundFor ??
    record.plan.queue.find((s): s is Extract<PlanStep, { kind: 'goto-system' }> => s.kind === 'goto-system')
      ?.systemIndex ??
    null
  if (dest == null || dest === record.systemIndex) return null
  return contactEtaHops(record.systemIndex, dest, galaxySeed)
}
