import { BODY_FADE, GALAXY_LAYER } from './config'

/**
 * Визуальное сжатие мира с 1×: worldR ∝ 1/scale — синхронно с ростом борта и отводом
 * камеры. С порога галактики (`BODY_FADE.START` = FADE_IN слоя) системных тел нет:
 * планеты/станции исчезают сразу, кадр отдаётся точкам галактики.
 */
export function worldShrink(scale: number): number {
  const s = Math.max(scale, 1)
  if (s >= BODY_FADE.START) return 0
  return 1 / s
}

/**
 * Звезда системы: вид честного 1/scale, но с отставанием ×STAR_INFLATE.
 *
 * До scale≈INFLATE — короткий выход с 1× на полку (вблизи солнце не ×10).
 * Дальше I=INFLATE постоянно → радиус R·INFLATE/scale: параллель планетной 1/scale,
 * у границы BODY_FADE стык размер-в-размер с шаром галактического слоя.
 */
export function starWorldShrink(scale: number): number {
  const s = Math.max(scale, 1)
  const S0 = BODY_FADE.START
  if (s >= S0) return 0
  const inflate = GALAXY_LAYER.STAR_INFLATE
  if (inflate <= 1) return 1 / s
  let I: number
  if (s < inflate) {
    // 1 → INFLATE пока scale идёт 1 → INFLATE; дальше полка.
    const u = (s - 1) / (inflate - 1)
    I = 1 + (inflate - 1) * u
  } else {
    I = inflate
  }
  return I / s
}
