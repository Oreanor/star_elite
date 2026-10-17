import { QUASAR } from '../../config/beams'
import { makeRng } from '../../core/math'

/**
 * Активно ли ядро галактики — квазар ли она. Чистая функция зерна: у всех игроков одни и те
 * же галактики светят джетами, и сервер посчитает то же самое без единой правки.
 *
 * Возвращает ось джетов (единичный вектор, «вверх» галактики — +Y) или `null`. Ось почти
 * вертикальна (`QUASAR.MAX_TILT`): прибытие в Ядро лежит в плоскости, и джет обязан идти мимо.
 */
export function quasarOf(galaxySeed: number): readonly [number, number, number] | null {
  // Своё подзерно: бросок не должен сдвигать ни один другой поток случайности галактики.
  const rng = makeRng((galaxySeed ^ 0x51a5a2) >>> 0)
  if (rng() >= QUASAR.SHARE) return null
  const tilt = rng() * QUASAR.MAX_TILT
  const azimuth = rng() * Math.PI * 2
  const s = Math.sin(tilt)
  return [s * Math.cos(azimuth), Math.cos(tilt), s * Math.sin(azimuth)]
}
