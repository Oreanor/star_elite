import data from './rig.json'
import type { Hardpoint } from './schema'

/**
 * ОСНАСТКА КОРПУСОВ, подобранная редактором (`apps/web/rig.html`) и записанная им в `rig.json`
 * кнопкой «СОХРАНИТЬ В ИГРУ». Это ДАННЫЕ, а не код: точки дул и подвесов, сопла, размер ракет.
 * Есть запись у корпуса — она перекрывает заводскую раскладку в `chassis.ts` (дула и подвесы)
 * и в `ships.ts` (сопла, ракеты); нет — всё как в коде.
 *
 * Руками файл не правят: его пишет редактор. Числа в метрах модельного пространства
 * (нос −Z, размах ±X, верх +Y).
 */
export interface RigNozzle {
  offset: [number, number, number]
  radius: number
}

export interface RigEntry {
  /** Дула и подвесы целиком — заменяют `hardpoints` шасси. */
  hardpoints?: Hardpoint[]
  /** Сопла — заменяют выхлоп корпуса в рендере. */
  nozzles?: RigNozzle[]
  /** Размер ракет на подвесах, множитель к заводской игле. */
  missileScale?: number
}

const RIG = data as Record<string, RigEntry>

/** Оснастка корпуса из редактора, если записана. */
export function rigOf(chassisId: string): RigEntry | undefined {
  return RIG[chassisId]
}
