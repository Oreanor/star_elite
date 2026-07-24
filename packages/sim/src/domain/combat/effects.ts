import { Vector3 } from 'three'
import { GUNNERY, TRACER_LIFE_SCALE } from '../../config/weapons'
import type { World } from '../world/entities'

/** Чисто визуальные эффекты. Симуляция от них не зависит — их можно не слать по сети. */

export function spawnTracer(
  world: World,
  from: Vector3,
  to: Vector3,
  hostile: boolean,
  weapon: string,
  /** Калибр точки: носовой след вдвое толще крыльевого. */
  bore = 1,
  /** Стрелок и связанное смещение дула — только для ПЕРВОГО отрезка (см. `Tracer.anchorId`). */
  anchorId?: number,
  anchorOffset?: readonly [number, number, number],
): void {
  // Жизнь трассы = базовая × множитель ствола: тяжёлый «Столб» тянет импульс длиннее.
  const life = GUNNERY.TRACER_LIFE * (TRACER_LIFE_SCALE[weapon] ?? 1)
  world.tracers.push({ from: from.clone(), to: to.clone(), born: world.time, hostile, weapon, life, bore, anchorId, anchorOffset })
}

/**
 * Взрыв наследует скорость того, что взорвалось: осколки не висят в пустоте.
 *
 * `startAt` — когда вспышка ЗАЖЖЁТСЯ (по умолчанию сейчас). Каскадной детонации нужны
 * очаги в разных фазах: рождаем их разом, но с разным временем старта, а рендер пропускает
 * то, чему ещё не время. Иначе десяток вспышек — это десяток одинаковых копий.
 */
export function spawnExplosion(world: World, pos: Vector3, vel: Vector3, scale: number, startAt?: number): void {
  world.explosions.push({ pos: pos.clone(), vel: vel.clone(), born: startAt ?? world.time, scale })
}

/**
 * СФЕРИЧЕСКАЯ ВОЛНА в мире: круг с градиентным краем, расходящийся из точки до `radius`.
 * Не экранная вспышка бомбы (`Shockwave`) — у этой есть место, и вдали она мельче, как
 * всякий объект сцены. `startAt` — момент «пуха»: он приходит уже после каскада вспышек.
 */
export function spawnBlastwave(world: World, pos: Vector3, radius: number, startAt?: number): void {
  world.blastwaves.push({ pos: pos.clone(), born: startAt ?? world.time, radius })
}

/**
 * Вспышка защитного поля станции в точке удара: снаряд погас, станция неуязвима.
 * `intensity` (0..1) задаёт яркость: прямое попадание — 1, отскок корабля — по силе удара.
 */
export function spawnShieldFlash(world: World, pos: Vector3, center: Vector3, intensity: number): void {
  world.shieldFlashes.push({ pos: pos.clone(), center: center.clone(), intensity, born: world.time })
}

/**
 * Вспышка энергетической бомбы. Ни позиции, ни скорости: это экранный эффект,
 * а не тело. Рисуется поверх корабля и живёт пару секунд.
 */
export function spawnShockwave(world: World, power: number): void {
  world.shockwaves.push({ born: world.time, power })
}
