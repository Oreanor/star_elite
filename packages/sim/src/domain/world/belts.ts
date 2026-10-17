import { Vector3 } from 'three'
import { ASTEROID_BELT } from '../../config/world'
import { liveAsteroidCount, spawnAsteroidEncounter } from './asteroidEncounter'
import type { AsteroidBeltEntity, World } from './entities'

/**
 * Пояса астероидов. Пояс — ОБЛАСТЬ вокруг светила, а не тысячи тел на всю систему: пока
 * корабль в ней, вокруг подрождаются камни (те же, что у встреч), и пояс ощущается полным;
 * вылетел — камни уйдут за кромку и уберутся обычной уборкой.
 *
 * Плоскость пояса — XZ системы, центр — светило (`centerId`), поэтому при сдвиге начала
 * координат пояс едет вместе со звездой сам.
 */

const _rel = new Vector3()

function centerOf(world: World, belt: AsteroidBeltEntity): Vector3 | null {
  return world.bodies.find((b) => b.id === belt.centerId)?.pos ?? null
}

/** Внутри ли точка пояса: по радиусу — в ширине кольца, по высоте — в его толщине. */
export function insideBelt(world: World, belt: AsteroidBeltEntity, pos: Vector3): boolean {
  const c = centerOf(world, belt)
  if (!c) return false
  _rel.copy(pos).sub(c)
  const planar = Math.hypot(_rel.x, _rel.z)
  return Math.abs(planar - belt.radius) <= belt.width / 2 && Math.abs(_rel.y) <= belt.thickness / 2
}

/**
 * Ближайшая к `pos` точка пояса (его объёма) и расстояние до неё, м; 0 — внутри.
 * Для локатора: «пояс там-то, до него столько-то».
 */
export function beltNearest(world: World, belt: AsteroidBeltEntity, pos: Vector3, out: Vector3): number {
  const c = centerOf(world, belt)
  if (!c) return Infinity
  _rel.copy(pos).sub(c)
  const planar = Math.hypot(_rel.x, _rel.z)
  // Направление в плоскости; над самым центром — любое.
  const ux = planar > 1e-6 ? _rel.x / planar : 1
  const uz = planar > 1e-6 ? _rel.z / planar : 0
  const r = Math.min(belt.radius + belt.width / 2, Math.max(belt.radius - belt.width / 2, planar))
  const y = Math.min(belt.thickness / 2, Math.max(-belt.thickness / 2, _rel.y))
  out.set(c.x + ux * r, c.y + y, c.z + uz * r)
  return out.distanceTo(pos)
}

/** Пояс, в котором сейчас точка, или null. */
export function beltAt(world: World, pos: Vector3): AsteroidBeltEntity | null {
  for (const belt of world.asteroidBelts) if (insideBelt(world, belt, pos)) return belt
  return null
}

/**
 * Шаг пояса: пока игрок в поясе, раз в `SPAWN_INTERVAL` секунд подрождается встреча камней,
 * пока вокруг их меньше `TARGET_LIVE`. Таймер в секундах такта — от частоты кадров не зависит.
 * Камни ведёт хозяин системы: у зеркала свои не рождаются (как у трафика).
 */
export function stepBelts(world: World, dt: number): void {
  if (world.desolate || world.trafficRole === 'mirror') return
  if (!beltAt(world, world.player.state.pos)) {
    world.beltSpawnTimer = 0
    return
  }
  world.beltSpawnTimer -= dt
  if (world.beltSpawnTimer > 0) return
  world.beltSpawnTimer = ASTEROID_BELT.SPAWN_INTERVAL
  if (liveAsteroidCount(world) < ASTEROID_BELT.TARGET_LIVE) spawnAsteroidEncounter(world)
}
