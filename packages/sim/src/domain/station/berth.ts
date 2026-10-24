import type { World } from '../world/entities'

/**
 * ПРИЧАЛЫ трафика — по одному кораблю на станцию за раз. Занятость ведётся ПО СТАНЦИИ
 * (`world.berths`: станция → борт): прежде причал был один на систему, и бот у одной станции
 * ждал, пока отчалит борт у другой, а заходящий на стыковку разворачивался к той станции,
 * у которой оказывался игрок. Игрок стыкуется своим путём (`docked`) и сюда не пишется.
 */

/** Кто занимает причал станции. null — свободен. */
export function berthOccupant(world: World, stationId: number): number | null {
  return world.berths.get(stationId) ?? null
}

/** Занять причал станции. */
export function claimBerth(world: World, stationId: number, shipId: number): void {
  world.berths.set(stationId, shipId)
}

/** Освободить всё, что держит борт (ушёл, погиб, сорвался из очереди). */
export function releaseBerth(world: World, shipId: number): void {
  for (const [station, ship] of world.berths) if (ship === shipId) world.berths.delete(station)
}

/** Держит ли борт какой-нибудь причал. */
export function holdsBerth(world: World, shipId: number): boolean {
  for (const ship of world.berths.values()) if (ship === shipId) return true
  return false
}

/**
 * Причал держит только живой стыкующийся. Погиб, ушёл или уже отчалил — место свободно,
 * иначе очередь к станции встанет навсегда.
 */
export function pruneBerths(world: World): void {
  for (const [station, id] of world.berths) {
    const ship = world.ships.find((s) => s.id === id)
    const stationAlive = world.bodies.some((b) => b.id === station)
    if (!stationAlive || !ship || !ship.alive || ship.ai?.dock == null || ship.ai.dock === 'done') world.berths.delete(station)
  }
}
