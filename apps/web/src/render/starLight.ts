import { Color, Vector3 } from 'three'
import { COSMIC, renderTime, type BodyEntity, type Cataclysm, type World } from '@elite/sim'
import { CATACLYSM, LIGHT } from './config'

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
    if (body.kind !== 'star' || body.faint) continue
    const d = body.pos.distanceToSquared(from)
    if (d < nearest) {
      nearest = d
      best = body
    }
  }
  return best
}

/**
 * Гибнущая звезда — ещё источник света: домен вынул тело в миг выстрела, а глазу она
 * светит до конца зрелища (`world.cataclysms`). Возвращает долю солнечного света
 * (0 — гибнущих нет) и ближайшую из них в `out` (позиция в координатах сцены).
 */
export function dyingStarLight(world: World, from: Vector3, out: { pos: Vector3; color: number }): number {
  let best: Cataclysm | null = null
  let nearest = Infinity
  for (const c of world.cataclysms) {
    if (c.kind !== 'star') continue
    _at.copy(c.at).sub(world.originOffset)
    const d = _at.distanceToSquared(from)
    if (d < nearest) {
      nearest = d
      best = c
    }
  }
  if (!best) return 0
  out.pos.copy(best.at).sub(world.originOffset)
  out.color = best.color
  const L = CATACLYSM.STAR_LIGHT
  const implode = COSMIC.BURST.star
  const age = renderTime(world) - best.born
  if (age < implode) {
    const pre = Math.max(0, age) / implode
    return 1 + L.PRE_HEAT * pre * pre
  }
  const t = age - implode
  return L.FLASH * Math.exp(-t / L.FLASH_TAU) + L.GLOW * Math.exp(-t / L.GLOW_TAU)
}

const _at = new Vector3()

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
