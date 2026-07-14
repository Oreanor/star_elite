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

/** Вторая компонента пары — чёрная дыра вместо звезды B (только shared start). */
export function patchSharedStart(def: SystemDef, index: number, galaxySeed: number): SystemDef {
  if (index !== SHARED_START_INDEX || galaxySeed !== GALAXY.SEED) return def
  const comp = def.companion
  if (!comp || comp.kind === 'blackhole') return def

  return {
    ...def,
    companion: {
      kind: 'blackhole',
      name: 'Глотка',
      radius: def.star.radius * 0.06,
      visualRadius: comp.radius,
      separation: comp.separation,
      diskAxis: [0.12, 1, 0.07],
    },
  }
}
