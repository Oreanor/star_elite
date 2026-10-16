import { findModule } from '@elite/sim'

/**
 * ШКОЛА лазера — для цвета луча. Домен несёт на трассе лишь id ствола, школу рендер узнаёт
 * по его эффекту в каталоге:
 *  military — военный (по умолчанию у всех: камень в пыль) — красный;
 *  tech     — технический, горный (`cut`: колет камень) — зелёный;
 *  special  — лучи-переделки (`shrink` / `grow` / `hold`) — голубой.
 * Неизвестный id — военный: обычный ствол, раз о нём ничего не известно.
 */
export type LaserSchool = 'military' | 'tech' | 'special'

export const LASER_SCHOOLS: readonly LaserSchool[] = ['military', 'tech', 'special']

export function laserSchool(weapon: string): LaserSchool {
  const m = findModule(weapon)
  const effect = m && m.kind === 'laser' ? m.effect : undefined
  if (effect === 'cut') return 'tech'
  if (effect === 'shrink' || effect === 'grow' || effect === 'hold') return 'special'
  return 'military'
}
