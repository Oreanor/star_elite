import { QUASAR } from '../../config/beams'
import { makeRng } from '../../core/math'

/**
 * ХАРАКТЕР квазара — у каждого свой: множители длины и полураствора джетов, 0..1-доли для
 * облика (размер диска, палитра) читает рендер. Чистая функция имени тела: у всех игроков
 * один и тот же квазар выглядит одинаково, и опасная зона джета совпадает с видимой.
 */
export interface QuasarLook {
  jetLength: number
  jetAngle: number
  /** 0..1 — размер газового диска. */
  disk: number
  /** 0..1 — палитра диска и джетов. */
  palette: number
}

export function quasarLook(name: string): QuasarLook {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  const rng = makeRng((h ^ 0x0a5a5) >>> 0)
  const [l0, l1] = QUASAR.JET_LENGTH_SPREAD
  const [a0, a1] = QUASAR.JET_ANGLE_SPREAD
  return { jetLength: l0 + (l1 - l0) * rng(), jetAngle: a0 + (a1 - a0) * rng(), disk: rng(), palette: rng() }
}

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
