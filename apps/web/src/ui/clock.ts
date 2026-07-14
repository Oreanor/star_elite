import { formatGameDate } from './i18n/date'
import { gameTimeMs, initWorldClock } from '../app/net/worldClock'

export { gameTimeMs, initWorldClock }

/** Текущая игровая дата словами на языке интерфейса. Для HUD и станции. */
export function currentGameDate(): string {
  return formatGameDate(gameTimeMs())
}
