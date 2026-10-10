import type { ShipEntity } from '../world/entities'
import { isLaser, isMissile, isDrone } from '../loadout'

export type ThreatLevel = 'low' | 'moderate' | 'high' | 'extreme'

export interface ThreatAssessment {
  /** Сила борта относительно стокового игрока, где 1 ≈ один такой игрок. */
  readonly score: number
  readonly level: ThreatLevel
}

/**
 * Оценка для предупреждения, а не скрытая боевая поправка. Считаем фактический
 * борт: прокачка уже запечена в его модулях, поэтому карточка не врёт.
 * Ракеты учитываются как залп, а не как бесконечный DPS.
 */
export function assessThreat(ship: ShipEntity, reference: ShipEntity): ThreatAssessment {
  const durability = ship.spec.hull.hull + ship.spec.hull.shield + ship.spec.hull.shieldRegen * 8
  const referenceDurability = reference.spec.hull.hull + reference.spec.hull.shield + reference.spec.hull.shieldRegen * 8
  let sustained = 0
  let burst = 0
  for (const mount of ship.spec.mounts) {
    const weapon = mount.weapon
    if (isLaser(weapon)) sustained += weapon.beam ? weapon.damage : weapon.damage / Math.max(weapon.cooldown, 0.25)
    else if (isMissile(weapon)) burst += weapon.damage * Math.min(weapon.ammo, 4) * 0.08
    else if (isDrone(weapon)) burst += weapon.ammo * 3
  }
  const mobility = Math.max(0, ship.spec.tuning.MAX_SPEED / 120) +
    Math.max(0, ship.spec.tuning.PITCH_ACCEL + ship.spec.tuning.YAW_ACCEL) * 2
  const raw = durability / Math.max(referenceDurability, 1) * 0.5 +
    (sustained / 45 + burst / 120) * 0.35 + mobility / 20 * 0.15
  const score = Math.max(0, raw)
  return { score, level: threatLevel(score) }
}

export function threatLevel(score: number): ThreatLevel {
  if (score < 0.45) return 'low'
  if (score < 0.9) return 'moderate'
  if (score < 1.6) return 'high'
  return 'extreme'
}
