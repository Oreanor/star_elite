import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { generateGalaxy } from './generate'
import { DIRECTORY, galaxyDirectory } from './directory'
import { hasFeature } from './features'

/**
 * Звёздный справочник станции. Пойманное: диспетчер не знал ничего за краем своей системы —
 * ни ближайшего высокого теха, ни квазара. Проверяем свойства справки, а не числа каталога.
 */
const seed = GALAXY.SEED
const systems = generateGalaxy(seed)
const here = 1
const dir = galaxyDirectory(systems, here, seed)

describe('звёздный справочник', () => {
  it('соседи — по близости, без своей системы', () => {
    expect(dir.near.length).toBe(DIRECTORY.NEAR)
    expect(dir.near.some((e) => e.index === here)).toBe(false)
    for (let i = 1; i < dir.near.length; i++) expect(dir.near[i]!.ly).toBeGreaterThanOrEqual(dir.near[i - 1]!.ly)
  })

  it('«ближайший с признаком» и вправду с ним и вправду ближайший', () => {
    expect(dir.notable.length).toBeGreaterThan(0)
    for (const { what, entry } of dir.notable) {
      const sys = systems.find((s) => s.index === entry.index)!
      if (what === 'topTech') expect(entry.maxTech).toBeGreaterThanOrEqual(DIRECTORY.TOP_TECH)
      else expect(hasFeature(sys, what, seed)).toBe(true)
      // Ни одна система ближе не обладает тем же признаком.
      const closer = dir.near.filter((e) => e.ly < entry.ly)
      for (const e of closer) {
        if (what === 'topTech') expect(e.maxTech).toBeLessThan(DIRECTORY.TOP_TECH)
        else expect(e.features).not.toContain(what)
      }
    }
  })

  it('чёрная дыра ядра всегда найдётся: она в каждой галактике', () => {
    expect(dir.notable.some((n) => n.what === 'blackhole')).toBe(true)
  })

  it('необитаемая система — без столицы и с нулевым техом', () => {
    for (const e of dir.near) {
      if (e.capital === null) expect(e.maxTech).toBe(0)
      else expect(e.maxTech).toBeGreaterThan(0)
    }
  })
})
