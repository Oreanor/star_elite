import { findModule } from '@elite/sim'

/**
 * ШКОЛА лазера — для цвета луча. Домен несёт на трассе лишь id ствола, школу рендер узнаёт
 * по его эффекту в каталоге:
 *  military — военный (по умолчанию у всех: камень в пыль) — красный;
 *  tech     — технический, горный (`cut`: колет камень) — зелёный;
 *  shrink   — уменьшающий луч — фиолетовый;
 *  grow     — увеличивающий луч — голубой;
 *  hold     — удерживающий луч — жёлтый;
 *  seed     — засевающий луч (космический) — изумрудно-бирюзовый;
 *  shatter  — разбивающий импульс (космический) — белёсо-сиреневый.
 * У каждого луча-переделки свой цвет: какой из трёх бьёт, видно сразу.
 * Неизвестный id — военный: обычный ствол, раз о нём ничего не известно.
 */
export type LaserSchool = 'military' | 'tech' | 'shrink' | 'grow' | 'hold' | 'seed' | 'shatter'

export const LASER_SCHOOLS: readonly LaserSchool[] = ['military', 'tech', 'shrink', 'grow', 'hold', 'seed', 'shatter']

/** Облик ствола для рендера: школа (цвет) и класс (толщина). */
export interface LaserLook {
  school: LaserSchool
  cls: 1 | 2 | 3
}

/**
 * Облик по id — КЭШ на всю игру: каталог неизменен, а спрашивают его в кадре по каждому
 * следу в каждой партии. Линейный `findModule` там стоил сотни тысяч сравнений строк за
 * кадр боя — кадр проседал, и интерполяция дёргала всю картинку.
 */
const looks = new Map<string, LaserLook>()

export function laserLook(weapon: string): LaserLook {
  let look = looks.get(weapon)
  if (!look) {
    const m = findModule(weapon)
    const effect = m && m.kind === 'laser' ? m.effect : undefined
    const school: LaserSchool =
      effect === 'cut' ? 'tech' : effect === 'shrink' || effect === 'grow' || effect === 'hold' || effect === 'seed' || effect === 'shatter' ? effect : 'military'
    // Класс 4 (если появится) читаем как 3; неизвестный id — класс 1.
    const raw = m?.class ?? 1
    look = { school, cls: (raw >= 3 ? 3 : raw) as 1 | 2 | 3 }
    looks.set(weapon, look)
  }
  return look
}

export function laserSchool(weapon: string): LaserSchool {
  return laserLook(weapon).school
}
