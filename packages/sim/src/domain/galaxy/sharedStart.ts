import { GALAXY } from '../../config/galaxy'
import type { SystemDef } from '../world/system'

/**
 * Онлайн-спавн новичков при родном зерне: первая система со станцией после
 * ядра и дома. С GALAXY.SEED это индекс 1 — «Люрилар», двойная (генератор).
 *
 * На сервере все начинают здесь; правки для старта живут в этом файле, а не
 * в рукописном STARTER_SYSTEM (дом / Тиррион — другой индекс).
 */
export const SHARED_START_INDEX = 1 as const

/**
 * Штатную двойную не трогаем. Для визуальной отладки добавляем отдельную
 * «Глотку» в 10 000 км от станции и привязываем её к движению станции.
 */
export function patchSharedStart(def: SystemDef, index: number, galaxySeed: number): SystemDef {
  if (index !== SHARED_START_INDEX || galaxySeed !== GALAXY.SEED) return def
  if (def.blackHoles?.some((hole) => hole.name === 'Глотка')) return def

  return {
    ...def,
    blackHoles: [
      ...(def.blackHoles ?? []),
      {
        name: 'Глотка',
        radius: 300_000,
        stationOffset: [10_000_000, 0, 0],
        diskAxis: [0.12, 1, 0.07],
      },
    ],
  }
}
