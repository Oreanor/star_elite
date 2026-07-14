import { GRIEVANCE } from '../../config/ai'
import { DIALOGUE } from '../../config/dialogue'
import { applyStance } from '../world/acquaintance'
import type { ShipEntity, World } from '../world/entities'

/**
 * Обида: как не-враждебный борт реагирует на попадания ИГРОКА.
 *
 * Первые `FORGIVE_HITS` попаданий мирный списывает на промах — без претензии и
 * без вызова. Дальше копит обиду, зовёт по связи и через `RETALIATE_TIME` без
 * извинения открывает ответный огонь; упорная пальба — сразу по `HOSTILE_HITS`.
 */

function canResent(ship: ShipEntity): boolean {
  return ship.alive && ship.ai !== null && ship.faction === 'neutral'
}

function resetEpisode(ai: NonNullable<ShipEntity['ai']>): void {
  ai.grievance = 0
  ai.grievanceSince = -1e9
  ai.strikeCount = 0
}

function beginGrievance(ai: NonNullable<ShipEntity['ai']>, time: number): void {
  if (ai.grievance === 0) ai.grievanceSince = time
}

function escalateToHostile(world: World, ship: ShipEntity): void {
  applyStance(world, ship, 'hostile')
  const ai = ship.ai
  if (!ai) return
  resetEpisode(ai)
  ai.targetId = world.player.id
  ai.orderedTargetId = world.player.id
}

/**
 * Засчитать попадание игрока. Возвращает false, если это дебаунс или попадание
 * в пределах «прощения» — претензии ещё нет.
 */
function registerStrike(world: World, victim: ShipEntity): boolean {
  const ai = victim.ai!

  if (ai.strikeCount > 0 && world.time - ai.grievanceAt < GRIEVANCE.HIT_DEBOUNCE) {
    ai.grievanceAt = world.time
    return false
  }

  if (world.time - ai.grievanceAt > GRIEVANCE.COOLDOWN) resetEpisode(ai)

  ai.strikeCount += 1
  ai.grievanceAt = world.time

  return ai.strikeCount > GRIEVANCE.FORGIVE_HITS
}

export function registerPlayerHit(world: World, victim: ShipEntity): void {
  if (!canResent(victim)) return
  if (!registerStrike(world, victim)) return

  const ai = victim.ai!
  beginGrievance(ai, world.time)
  ai.grievance += 1

  if (ai.grievance >= GRIEVANCE.HOSTILE_HITS) {
    escalateToHostile(world, victim)
  }
}

export function provoke(world: World, victim: ShipEntity, weight = 1): void {
  if (!canResent(victim)) return
  const ai = victim.ai!

  if (world.time - ai.grievanceAt > GRIEVANCE.COOLDOWN) resetEpisode(ai)

  beginGrievance(ai, world.time)
  ai.grievance += weight
  ai.grievanceAt = world.time

  if (ai.grievance >= GRIEVANCE.HOSTILE_HITS) {
    escalateToHostile(world, victim)
  }
}

export function hasGrievance(ship: ShipEntity): boolean {
  return canResent(ship) && (ship.ai?.grievance ?? 0) > 0
}

export function pendingHail(world: World): ShipEntity | null {
  let best: ShipEntity | null = null
  let bestDist = Infinity
  for (const ship of world.ships) {
    if (!hasGrievance(ship)) continue
    const dist = ship.state.pos.distanceTo(world.player.state.pos)
    if (dist <= DIALOGUE.RANGE && dist < bestDist) {
      best = ship
      bestDist = dist
    }
  }
  return best
}

export function defuseGrievance(ship: ShipEntity): boolean {
  if (!ship.ai || (ship.ai.grievance === 0 && ship.ai.strikeCount === 0)) return false
  resetEpisode(ship.ai)
  return true
}

export function stepGrievances(world: World): void {
  for (const ship of world.ships) {
    const ai = ship.ai
    if (!ai || !canResent(ship)) continue

    // Прощённая серия без претензии остывает целиком. Начал обижаться — сначала
    // таймер ответного огня, потом уже прощение по COOLDOWN после эскалации или
    // разрядки.
    if (ai.grievance === 0 && ai.strikeCount > 0 && world.time - ai.grievanceAt > GRIEVANCE.COOLDOWN) {
      resetEpisode(ai)
      continue
    }

    if (ai.grievance === 0) continue

    if (world.time - ai.grievanceAt > GRIEVANCE.COOLDOWN) {
      resetEpisode(ai)
      continue
    }

    const angrySince = ai.grievanceSince > -1e8 ? ai.grievanceSince : ai.grievanceAt
    if (world.time - angrySince + 1e-6 >= GRIEVANCE.RETALIATE_TIME) {
      escalateToHostile(world, ship)
    }
  }
}
