/**
 * Чужие живые игроки в МОЕЙ системе: uid → id их кинематического борта в `world.ships`.
 * Ведёт `RemotePlayers` (он их материализует), читает общий трафик: хозяину нужно знать,
 * чей борт стрелял по его боту и есть ли вообще кому слать кадры.
 */
export const peerShips = new Map<string, number>()

/** uid чужого игрока по id его борта; null — это не чужой игрок. */
export function peerUidOf(shipId: number): string | null {
  for (const [uid, id] of peerShips) if (id === shipId) return uid
  return null
}
