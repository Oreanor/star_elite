import { WARBASE_GEN } from '../../config/warbase'
import { makeRng } from '../../core/math'
import type { WarBaseDef } from '../world/system'
import { capitalOf, type StarSystem } from './types'

/**
 * Военные базы системы — из каталога и зерна, без броска на месте: у всех игроков одни и те
 * же базы на тех же местах. Свой поток случайности (соль `0x57415242`), чтобы генерация
 * баз не сдвигала ни одну другую величину системы.
 *
 * Смещение — от причала-места выхода (`placeWarBases`); в системе без причала — от точки
 * выхода из прыжка: заброшенная база стоит там, где её и найдут.
 */
export function warBasesOf(system: StarSystem, galaxySeed: number): WarBaseDef[] {
  const rng = makeRng(((galaxySeed ^ 0x57415242) + Math.imul(system.index + 1, 0x9e3779b1)) >>> 0)
  const capital = capitalOf(system)
  let count = 0
  let abandoned = false
  if (!capital) {
    abandoned = rng() < WARBASE_GEN.ABANDONED_CHANCE
    count = abandoned ? 1 : 0
  } else {
    const tech = capital.settlement.techLevel
    const gov = capital.settlement.government
    const range = WARBASE_GEN.BY_GOVERNMENT[gov]
    if (range && tech >= WARBASE_GEN.TECH_MIN && tech <= WARBASE_GEN.TECH_MAX) {
      const [min, max] = range
      if (min > 0) count = min + Math.floor(rng() * (max - min + 1))
      else count = rng() < (WARBASE_GEN.SOME_CHANCE[gov] ?? 0) ? max : 0
    }
  }

  // ПАРАНОИДАЛЬНАЯ — только у живых (заброшенная одна): база у КАЖДОЙ планеты системы и
  // пара у причала. С десяток баз, разных и неизвестно зачем.
  const paranoid = count > 0 && !abandoned && rng() < 1 / WARBASE_GEN.FORTRESS_ONE_IN
  if (paranoid) count = 1 + Math.floor(rng() * 2)

  const out: WarBaseDef[] = []
  const names = WARBASE_GEN.NAMES
  const first = Math.floor(rng() * names.length)
  for (let i = 0; i < count; i++) {
    // Направление равномерно по сфере, но приплюснуто к плоскости системы: базы — у причала,
    // а не столбом над ним.
    const a = rng() * Math.PI * 2
    const y = (rng() * 2 - 1) * 0.35
    const d = WARBASE_GEN.DISTANCE_MIN + rng() * (WARBASE_GEN.DISTANCE_MAX - WARBASE_GEN.DISTANCE_MIN)
    const r = Math.sqrt(1 - y * y)
    const name = names[(first + i) % names.length]!
    out.push({
      name: abandoned ? `Заброшенная база «${name}»` : `База «${name}»`,
      radius: Math.round(WARBASE_GEN.RADIUS_MIN + rng() * (WARBASE_GEN.RADIUS_MAX - WARBASE_GEN.RADIUS_MIN)),
      stationOffset: [Math.round(Math.cos(a) * r * d), Math.round(y * d), Math.round(Math.sin(a) * r * d)],
      model: Math.floor(rng() * WARBASE_GEN.MODELS),
    })
  }
  if (paranoid) {
    system.planets.forEach((p, k) => {
      if (p.remnant) return
      const a = rng() * Math.PI * 2
      const y = (rng() * 2 - 1) * 0.35
      const r = Math.sqrt(1 - y * y)
      // Высота над поверхностью — как удаление от причала: база на орбите своего мира.
      const d = WARBASE_GEN.DISTANCE_MIN + rng() * (WARBASE_GEN.DISTANCE_MAX - WARBASE_GEN.DISTANCE_MIN)
      const name = names[(first + count + k) % names.length]!
      out.push({
        name: `База «${name}»`,
        radius: Math.round(WARBASE_GEN.RADIUS_MIN + rng() * (WARBASE_GEN.RADIUS_MAX - WARBASE_GEN.RADIUS_MIN)),
        stationOffset: [Math.round(Math.cos(a) * r * d), Math.round(y * d), Math.round(Math.sin(a) * r * d)],
        model: Math.floor(rng() * WARBASE_GEN.MODELS),
        anchorPlanet: k,
      })
    })
  }
  return out
}
