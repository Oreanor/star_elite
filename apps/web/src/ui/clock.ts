import { TIME } from '@elite/sim'
import { formatGameDate } from './i18n/date'

/**
 * Игровые часы КЛИЕНТА. Домен времени реального мира не касается (`Date.now` под
 * запретом ради сети) — читаем его здесь, в UI, и отдаём готовую дату HUD и станции.
 *
 * Пока сервера нет, точка отсчёта — момент запуска клиента: игровой календарь идёт
 * от эпохи (~3000), сжатый в `TIME.SCALE` раз. Когда появится сервер — он и станет
 * авторитетом времени, а здесь поменяется лишь источник `bootRealMs`/`gameTimeMs`.
 */

/** Реальный момент, от которого клиент ведёт отсчёт. Сервер потом подменит источник. */
const bootRealMs = Date.now()

/** Текущий игровой момент, мс от Unix (в сдвинутом к ~3000 календаре). */
export function gameTimeMs(): number {
  return TIME.EPOCH_MS + (Date.now() - bootRealMs) * TIME.SCALE
}

/** Текущая игровая дата словами на языке интерфейса. Для HUD и станции. */
export function currentGameDate(): string {
  return formatGameDate(gameTimeMs())
}
