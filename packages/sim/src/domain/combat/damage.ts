import type { LossHit, ShipEntity } from '../world/entities'

/**
 * Игрок не уходит в Game Over: летальный удар восстанавливает корпус и щит,
 * ставит штамп причины — HUD покажет красный «КОРАБЛЬ ПОТЕРЯН · …». Боты гибнут как раньше.
 */
export function surviveLethal(e: ShipEntity, time: number, cause: LossHit): void {
  e.alive = true
  e.hull = e.spec.hull.hull
  e.shield = e.spec.hull.shield
  e.hullHeat = 0
  e.lastLostAt = time
  e.lastLostHit = cause
}

/** Щит держит удар первым и не восстанавливается сразу после попадания. */
export function applyDamage(
  e: ShipEntity,
  amount: number,
  time: number,
  cause: LossHit = { kind: 'unknown', name: '' },
): void {
  if (!e.alive || amount <= 0) return
  e.lastHitAt = time

  let remaining = amount
  if (e.shield > 0) {
    const absorbed = Math.min(e.shield, remaining)
    e.shield -= absorbed
    remaining -= absorbed
    e.lastShieldHitAt = time // щит принял удар — рендер вспыхнёт защитной сферой
  }
  if (remaining > 0) {
    e.hull -= remaining
    e.lastHullHitAt = time // удар дошёл до корпуса — рендер тряхнёт кабину
  }

  if (e.hull <= 0) {
    if (e.faction === 'player') {
      // Временная мера: игрок бессмертен — причина в пуше, игра продолжается.
      surviveLethal(e, time, cause)
    } else {
      e.hull = 0
      e.alive = false
    }
  }
}

export function regenShield(e: ShipEntity, dt: number, time: number): void {
  if (!e.alive) return
  const { shieldRegenDelay, shieldRegen, shield: capacity } = e.spec.hull
  if (time - e.lastHitAt < shieldRegenDelay) return
  e.shield = Math.min(capacity, e.shield + shieldRegen * dt)
}

export function healthFraction(e: ShipEntity): number {
  return e.spec.hull.hull > 0 ? e.hull / e.spec.hull.hull : 0
}

export function shieldFraction(e: ShipEntity): number {
  return e.spec.hull.shield > 0 ? e.shield / e.spec.hull.shield : 0
}
