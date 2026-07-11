import type { Loadout } from '../loadout'
import { refreshSpec } from '../world'
import type { World } from '../world/entities'

/**
 * Верфь: смена КОРПУСА, а не отдельного модуля.
 *
 * Правило живёт в домене, как и всё остальное: где нажали кнопку — не его забота,
 * он лишь меняет сборку игрока и пересчитывает спеку. Однажды то же самое исполнит
 * сервер, ничего не правя.
 */

export type HullError = 'not-docked' | 'no-money'

/**
 * Взять корпус. Меняем сборку целиком и заправляем свежий корабль под завязку: полный
 * корпус, щит и заряд привода — покупаешь готовый к вылету, а не пустые слоты. Трюм
 * остаётся при пилоте: товар не выкидывают вместе со старым корпусом (перегруз честно
 * посчитает `refreshSpec`, лишнее просто не разгонится).
 */
export function buyHull(world: World, loadout: Loadout, cost: number): HullError | null {
  if (!world.docked) return 'not-docked'
  if (world.credits < cost) return 'no-money'

  world.credits -= cost
  const player = world.player
  player.loadout = loadout
  refreshSpec(player)
  player.hull = player.spec.hull.hull
  player.shield = player.spec.hull.shield
  player.jumpCharge = player.spec.jumpRange
  return null
}
