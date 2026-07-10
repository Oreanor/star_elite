import { Vector3 } from 'three'
import type { World } from '../world/entities'

/** Чисто визуальные эффекты. Симуляция от них не зависит — их можно не слать по сети. */

export function spawnTracer(world: World, from: Vector3, to: Vector3, hostile: boolean, weapon: string): void {
  world.tracers.push({ from: from.clone(), to: to.clone(), born: world.time, hostile, weapon })
}

/** Взрыв наследует скорость того, что взорвалось: осколки не висят в пустоте. */
export function spawnExplosion(world: World, pos: Vector3, vel: Vector3, scale: number): void {
  world.explosions.push({ pos: pos.clone(), vel: vel.clone(), born: world.time, scale })
}
