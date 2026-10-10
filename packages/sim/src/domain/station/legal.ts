import { findStation } from './docking'
import type { Commodity } from '../cargo/items'
import type { FineRecord, ShipEntity, World } from '../world/entities'
import { DIALOGUE } from '../../config/dialogue'

/** Идентификатор местной власти: станция привязана к конкретной планете. */
export function localAuthorityId(world: World): number | null {
  return findStation(world)?.orbit?.parentId ?? findStation(world)?.id ?? null
}

export function localFine(world: World): FineRecord | null {
  const authorityId = localAuthorityId(world)
  if (authorityId == null) return null
  return world.fines.find((f) => f.systemIndex === world.systemIndex && f.authorityId === authorityId) ?? null
}

/** Создать или увеличить местный штраф за нарушение. */
export function issueFine(world: World, amount: number, reason: FineRecord['reason']): FineRecord | null {
  const authorityId = localAuthorityId(world)
  if (authorityId == null || amount <= 0) return null
  const existing = localFine(world)
  if (existing) {
    existing.amount += Math.floor(amount)
    return existing
  }
  const fine: FineRecord = { systemIndex: world.systemIndex, authorityId, amount: Math.floor(amount), reason }
  world.fines.push(fine)
  return fine
}

/** Оплатить долг атомарно: при нехватке денег ни долг, ни кошелёк не меняются. */
export function payLocalFine(world: World): { ok: boolean; amount: number } {
  const fine = localFine(world)
  if (!fine || fine.amount <= 0 || world.credits < fine.amount) return { ok: false, amount: fine?.amount ?? 0 }
  const amount = fine.amount
  world.credits -= amount
  world.fines = world.fines.filter((f) => f !== fine)
  return { ok: true, amount }
}

function nearestPolice(world: World): ShipEntity | null {
  const player = world.player.state.pos
  let best: ShipEntity | null = null
  let bestDistance = Infinity
  for (const ship of world.ships) {
    if (!ship.alive || ship.faction !== 'police') continue
    const distance = ship.state.pos.distanceTo(player)
    if (distance <= DIALOGUE.RANGE && distance < bestDistance) {
      best = ship
      bestDistance = distance
    }
  }
  return best
}

/** Полиция рядом для автоматического напоминания; за посещение системы — один раз. */
export function pendingPoliceFineHail(world: World): ShipEntity | null {
  if (!localFine(world) || world.policeFineHailEpoch === world.epoch) return null
  return nearestPolice(world)
}

/** Ручной вызов ближайшей полиции не ограничен автоматическим напоминанием. */
export function hailPoliceForFine(world: World): ShipEntity | null {
  return localFine(world) ? nearestPolice(world) : null
}

export function markPoliceFineHail(world: World): void {
  world.policeFineHailEpoch = world.epoch
}

/** Суммарная масса товара с ограниченной торговлей; сама перевозка законна. */
export function illegalCargoUnits(world: World, illegal: readonly Commodity[]): number {
  let units = 0
  for (const item of world.player.hold.items) {
    if (item.kind !== 'commodity' || !illegal.some((commodity) => commodity.id === item.commodity.id)) continue
    units += item.units
  }
  return units
}
