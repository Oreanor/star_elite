import { AI } from '../../config/ai'
import { isEngageable } from '../combat/engage'
import type { Faction, ShipEntity, World } from '../world/entities'

/**
 * Кто кому враг. Правило, а не таблица «все против игрока» — иначе полиция
 * никогда не подерётся с пиратами, а бой перестаёт быть частью мира.
 */
export function isHostileTo(a: Faction, b: Faction): boolean {
  if (a === b) return false
  if (a === 'neutral' || b === 'neutral') return false
  // Пираты против всех, кто не пират; полиция и игрок — союзники по умолчанию.
  if (lawful(a) && lawful(b)) return false
  return true
}

const lawful = (f: Faction): boolean => f === 'player' || f === 'police'

/**
 * Ближайший враг в радиусе осведомлённости.
 * Прилипание к текущей цели намеренное: бот, каждый кадр меняющий жертву,
 * не доводит ни одной атаки до конца.
 */
export function selectTarget(self: ShipEntity, world: World): ShipEntity | null {
  const current = self.ai?.targetId ?? null

  let best: ShipEntity | null = null
  let bestDistance = AI.AWARENESS

  // Игрок (индекс −1) и борта — без склейки в новый массив: выбор цели идёт у каждого бота
  // в такте размышления, и `[player, ...ships]` плодил по массиву на бот.
  for (let i = world.player.alive ? -1 : 0; i < world.ships.length; i++) {
    const other = i < 0 ? world.player : world.ships[i]!
    // Замаскированного пилот не видит, стыкующегося не трогает.
    if (other === self || !isEngageable(other)) continue
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
