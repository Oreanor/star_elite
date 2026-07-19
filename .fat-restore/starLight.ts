import { Color, Vector3 } from 'three'
import type { BodyEntity, World } from '@elite/sim'
import { LIGHT } from './config'

/**
 * Ближайшая звезда и её спектр для рендера.
 *
 * Один способ выбрать «какое солнце светит» — иначе атмосфера брала первую в
 * списке, а Lighting/флейр — ближайшую, и у двойных систем терминатор врал.
 * Цвет ключевого света и тинты пыли/факела/лимба берутся отсюда же.
 */

const _star = new Color()
const _mix = new Color()

/** Ближайшая звезда к точке `from`. null — в системе нет светила. */
export function nearestStar(world: World, from: Vector3): BodyEntity | null {
  let best: BodyEntity | null = null
  let nearest = Infinity
  for (const body of world.bodies) {
    if (body.kind !== 'star') continue
    const d = body.pos.distanceToSquared(from)
    if (d < nearest) {
      nearest = d
      best = body
    }
  }
  return best
}

/** Цвет ключевого света: тёплый белый ↔ спектр звезды. Пишет в `out`. */
export function tintedSunColor(starColor: number, out: Color): Color {
  return out.setHex(LIGHT.SUN_BASE).lerp(_star.setHex(starColor), LIGHT.SUN_TINT)
}

/**
 * Подмешать спектр звезды к базовому цвету эффекта (пыль, факел, лимб).
 * `amount` 0 — база, 1 — чистый спектр. Возвращает hex.
 */
export function starTintHex(base: number, starColor: number, amount: number): number {
  return _mix.setHex(base).lerp(_star.setHex(starColor), amount).getHex()
}

/** То же в Color — для шейдерных uniform'ов без аллокации снаружи. */
export function starTintColor(base: number, starColor: number, amount: number, out: Color): Color {
  return out.setHex(base).lerp(_star.setHex(starColor), amount)
}
