import { ECM } from '../../config/weapons'
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

  const cost = e.spec.power.capacity * ECM.ENERGY_COST
  if (cost <= 0 || e.energy < cost) return false

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

  e.energy -= cost
  e.ecmCooldown = ECM.COOLDOWN
  nearest.alive = false
  spawnExplosion(world, nearest.pos, nearest.vel, 1.2)
  return true
}

/** Батареи копятся сами. Зовётся каждый шаг для каждого корабля. */
export function regenEnergy(e: ShipEntity, dt: number): void {
  e.ecmCooldown = Math.max(0, e.ecmCooldown - dt)
  if (!e.alive) return
  e.energy = Math.min(e.spec.power.capacity, e.energy + e.spec.power.regen * dt)
}

/** Доля заряда батарей, 0..1. Нужно HUD и ИИ. */
export function energyFraction(e: ShipEntity): number {
  return e.spec.power.capacity > 0 ? e.energy / e.spec.power.capacity : 0
}
