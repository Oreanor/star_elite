import { describe, expect, it } from 'vitest'
import { MODULE_CATALOGUE } from '../../config/modules'
import * as L from '../../config/loadouts'
import { SHIPYARD } from '../../config/loadouts'
import { slotCategoryOf, type Loadout } from '.'

/**
 * ИНВАРИАНТЫ КАТАЛОГА. Не числа, а правила, которые ломались при правке данных: стартовую сборку
 * переставляли на другую раму, и класс железа переставал совпадать; массы правили вручную и
 * оставляли «0.4 т»; оружие истребителей раскладывалось не по номерам точек — ракеты садились
 * на орудийные точки. Каталог — данные, и проверять его надо как данные: целиком.
 */

/** Сборка ставится на свою раму: виды и число по слотам, класс — не выше класса корпуса. */
function loadoutFits(l: Loadout): string[] {
  const errors: string[] = []
  const c = l.chassis
  const used = new Map<string, number>()
  for (const m of l.internals) {
    const cat = slotCategoryOf(m.kind)
    used.set(cat, (used.get(cat) ?? 0) + 1)
    if (m.class > c.class) errors.push(`${m.id}: класс ${m.class} > корпуса ${c.class}`)
  }
  for (const [cat, n] of used) {
    const slots = c.slots.filter((s) => s.kind === cat).length
    if (n > slots) errors.push(`${cat}: ${n} модулей при ${slots} слотах`)
  }
  l.weapons.forEach((w, i) => {
    if (!w) return
    const hp = c.hardpoints[i]
    if (!hp) return errors.push(`оружие ${w.id} на несуществующей точке ${i}`)
    const wanted = w.kind === 'laser' ? 'gun' : 'pylon'
    if (hp.kind !== wanted) errors.push(`${w.id} на точке «${hp.kind}» (${i})`)
    if (w.class > c.class) errors.push(`${w.id}: класс ${w.class} > корпуса ${c.class}`)
  })
  return errors
}

describe('каталог', () => {
  it('КАЖДАЯ сборка из каталога (верфь, старт, пираты, трафик, бог) встаёт на свою раму', () => {
    // Все экспортированные `*Loadout()` — новая сборка попадает в проверку сама.
    const all: [string, Loadout][] = [
      ...Object.entries(L)
        .filter(([k, v]) => k.endsWith('Loadout') && typeof v === 'function')
        .map(([k, f]) => [k, (f as () => Loadout)()] as [string, Loadout]),
      ...SHIPYARD.map((o) => [o.chassis.name, o.loadout()] as [string, Loadout]),
    ]
    expect(all.length).toBeGreaterThan(10)
    for (const [name, l] of all) expect(loadoutFits(l), name).toEqual([])
  })

  it('масса оборудования — целые тонны, не меньше одной (кроме пушки дрона)', () => {
    for (const m of MODULE_CATALOGUE) {
      if (m.id === 'drone_gun') continue
      expect(Number.isInteger(m.mass) && m.mass >= 1, `${m.id}: ${m.mass} т`).toBe(true)
    }
  })

  it('id модулей уникальны: сейв и сеть узнают деталь по id', () => {
    const ids = new Set<string>()
    for (const m of MODULE_CATALOGUE) {
      expect(ids.has(m.id), `повтор id ${m.id}`).toBe(false)
      ids.add(m.id)
    }
  })
})
