import { BODY_FADE } from './config'

/**
 * Визуальное сжатие мира с 1×: worldR ∝ 1/scale — синхронно с ростом борта и отводом
 * камеры. С порога галактики (`BODY_FADE.START` = FADE_IN слоя) системных тел нет:
 * звезда/планеты/станции исчезают сразу, кадр отдаётся точкам галактики.
 */
export function worldShrink(scale: number): number {
  const s = Math.max(scale, 1)
  if (s >= BODY_FADE.START) return 0
  return 1 / s
}
