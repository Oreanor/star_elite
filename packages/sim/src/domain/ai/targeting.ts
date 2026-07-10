import { AI } from '../../config/ai'
import { isVisible } from '../combat/cloak'
import type { Faction, ShipEntity, World } from '../world/entities'

/**
 * Кто кому враг. Правило, а не таблица «все против игрока» — иначе полиция
 * никогда не подерётся с пиратами, а бой перестаёт быть частью мира.
 */
export function isHostileTo(a: Faction, b: Faction): boolean {
  if (a === b) return false
  if (a === 'neutral' || b === 'neutral') return false
  // Пираты против всех, кто не пират; полиция и игрок — союзники по умолчанию.
  const lawful = (f: Faction) => f === 'player' || f === 'police'
  if (lawful(a) && lawful(b)) return false
  return true
}

function candidates(world: World): ShipEntity[] {
  return world.player.alive ? [world.player, ...world.ships] : world.ships
}

/**
 * Ближайший враг в радиусе осведомлённости.
 * Прилипание к текущей цели намеренное: бот, каждый кадр меняющий жертву,
 * не доводит ни одной атаки до конца.
 */
export function selectTarget(self: ShipEntity, world: World): ShipEntity | null {
  const current = self.ai?.targetId ?? null

  let best: ShipEntity | null = null
  let bestDistance = AI.AWARENESS

  for (const other of candidates(world)) {
    // Замаскированного пилот не видит — как не видит и мёртвого.
    if (other === self || !isVisible(other)) continue
    if (!isHostileTo(self.faction, other.faction)) continue

    const distance = other.state.pos.distanceTo(self.state.pos)
    if (distance > AI.AWARENESS) continue

    // Текущей цели даём фору: менять её стоит только ради заметно более близкой.
    const bias = other.id === current ? AI.TARGET_STICKINESS : 1
    if (distance * bias < bestDistance) {
      bestDistance = distance * bias
      best = other
    }
  }
  return best
}
