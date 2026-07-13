import { ECM } from '../../config/weapons'
import { findEcm } from '../loadout'
import type { ShipEntity, World } from '../world/entities'
import { spawnExplosion } from './effects'

/**
 * Противоракетный импульс. Подрывает БЛИЖАЙШУЮ ЧУЖУЮ ракету в радиусе.
 *
 * Одна ракета за пуск, а не все разом: залп из двух ракет обязан быть страшнее
 * одной, иначе ПРО отменяет ракеты как класс. Цена импульса — доля батарей,
 * поэтому и увернуться, и сбить лазером остаются нужными умениями.
 *
 * Чужая — значит выпущенная не этим кораблём. Свою подрывать незачем.
 */
export function fireEcm(world: World, e: ShipEntity): boolean {
  if (!e.alive || e.ecmCooldown > 0) return false

  // Расход импульса — по КЛАССУ установленного ПРО: старший модуль экономичнее.
  const ecm = findEcm(e.loadout)
  const fraction = ecm ? ECM.COST_BY_CLASS[ecm.class] ?? ECM.COST_DEFAULT : ECM.COST_DEFAULT
  const cost = e.spec.power.auxCapacity * fraction
  if (cost <= 0 || e.auxEnergy < cost) return false

  let nearest = null
  let nearestSq = ECM.RADIUS * ECM.RADIUS

  for (const m of world.missiles) {
    if (!m.alive || m.ownerId === e.id) continue
    const dSq = m.pos.distanceToSquared(e.state.pos)
    if (dSq < nearestSq) {
      nearestSq = dSq
      nearest = m
    }
  }

  // Энергию жжём только за результат: холостой импульс — это просто «нечего сбивать».
  if (!nearest) return false

  e.auxEnergy -= cost
  e.ecmCooldown = ECM.COOLDOWN
  nearest.alive = false
  spawnExplosion(world, nearest.pos, nearest.vel, 1.2)
  return true
}

/** ГЛАВНАЯ батарея копится сама. Зовётся каждый шаг для каждого корабля. */
export function regenEnergy(e: ShipEntity, dt: number): void {
  e.ecmCooldown = Math.max(0, e.ecmCooldown - dt)
  if (!e.alive) return
  e.energy = Math.min(e.spec.power.capacity, e.energy + e.spec.power.regen * dt)
}

/** Батарея ДОП-ОТСЕКА копится сама (свой пул для бомбы/ПРО/маскировки). Зовётся каждый шаг. */
export function regenAux(e: ShipEntity, dt: number): void {
  if (!e.alive) return
  e.auxEnergy = Math.min(e.spec.power.auxCapacity, e.auxEnergy + e.spec.power.auxRegen * dt)
}

/** Доля заряда ГЛАВНОЙ батареи, 0..1. Нужно HUD и ИИ. */
export function energyFraction(e: ShipEntity): number {
  return e.spec.power.capacity > 0 ? e.energy / e.spec.power.capacity : 0
}

/** Доля заряда батареи ДОП-ОТСЕКА, 0..1. Нужно HUD. */
export function auxFraction(e: ShipEntity): number {
  return e.spec.power.auxCapacity > 0 ? e.auxEnergy / e.spec.power.auxCapacity : 0
}
