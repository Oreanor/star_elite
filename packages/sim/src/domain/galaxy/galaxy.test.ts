import { describe, expect, it } from 'vitest'
import { CORE_INDEX, GALAXY } from '../../config/galaxy'
import { generateGalaxy, generateSystem } from './generate'
import { distanceLy, galaxyShape, placeSystem } from './shape'
import { capitalOf, isInhabited, settledPlanets, stationsOf, systemLife } from './types'

/**
 * Генератор обязан быть статичным: одно зерно — одна и та же галактика.
 * Без этого невозможны ни сохранения, ни сетевая игра.
 */
describe('генерация галактики', () => {
  it('детерминирована: то же зерно даёт ту же галактику', () => {
    expect(generateGalaxy(1234)).toEqual(generateGalaxy(1234))
  })

  // Индекс 0 — всегда «Ядро» в любой галактике, сравнивать зёрна по нему нельзя.
  it('разные зёрна дают разные галактики', () => {
    expect(generateGalaxy(1)[1]?.name).not.toBe(generateGalaxy(2)[1]?.name)
  })

  it('одиночная система совпадает с той же системой из полной галактики', () => {
    // generateSystem(i) обязан быть независим от соседей: иначе нельзя будет
    // подгружать системы по требованию, когда их станет 250 000.
    const galaxy = generateGalaxy()
    const solo = generateSystem(7)
    // Имя могло быть разведено при коллизии — сравниваем всё остальное.
    expect({ ...galaxy[7]!, name: '' }).toEqual({ ...solo, name: '' })
  })

  it('строит ровно COUNT систем с уникальными именами', () => {
    const galaxy = generateGalaxy()
    expect(galaxy).toHaveLength(GALAXY.COUNT)
    expect(new Set(galaxy.map((s) => s.name)).size).toBe(galaxy.length)
  })
})

/**
 * Форма галактики выводится из зерна. Прыжок через ядро даёт новое зерно —
 * а значит, и другую галактику по Хабблу. Разнообразие берётся из математики.
 */
describe('форма галактики', () => {
  it('одно зерно — одна форма', () => {
    expect(galaxyShape(777).id).toBe(galaxyShape(777).id)
  })

  it('по зёрнам встречается не одна форма', () => {
    const ids = new Set(Array.from({ length: 40 }, (_, i) => galaxyShape(i * 7919).id))
    expect(ids.size).toBeGreaterThan(1)
  })

  it('звёзды не вылетают за диск и он объёмный, но плоский', () => {
    const galaxy = generateGalaxy()
    let maxZ = 0
    for (const s of galaxy) {
      // Хвосты гауссианы длинные: край диска — не жёсткая стена, но и не вдвое дальше.
      expect(Math.hypot(s.x, s.y)).toBeLessThan(GALAXY.RADIUS_LY * 1.6)
      maxZ = Math.max(maxZ, Math.abs(s.z))
    }
    // Не бумажка (z есть) и не шар (z много меньше радиуса).
    expect(maxZ).toBeGreaterThan(GALAXY.THICKNESS_LY)
    expect(maxZ).toBeLessThan(GALAXY.RADIUS_LY * 0.75)
  })

  /**
   * Чёрная дыра — единственная, и она ровно в центре. На ней держится переход
   * между галактиками: сместись она, и «долететь до центра» потеряет смысл.
   */
  it('в центре чёрная дыра, и она одна', () => {
    const galaxy = generateGalaxy()
    const core = galaxy[CORE_INDEX]!
    expect(core.star.class).toBe('H')
    expect(placeSystem(CORE_INDEX)).toEqual({ x: 0, y: 0, z: 0 })
    expect(core.planets).toHaveLength(0)
    expect(galaxy.filter((s) => s.star.class === 'H')).toHaveLength(1)
  })

  /** Место звезды не должно зависеть от её класса: иначе рукава окрасятся по спектру. */
  it('расстояние симметрично и обнуляется на себе', () => {
    const a = placeSystem(11)
    const b = placeSystem(12)
    expect(distanceLy(a, a)).toBe(0)
    expect(distanceLy(a, b)).toBeCloseTo(distanceLy(b, a))
  })
})

describe('инварианты системы', () => {
  const galaxy = generateGalaxy()

  it('обитаемая система имеет хотя бы одну планету и столицу', () => {
    // Регрессия: население без планет — жить негде, станции висеть не на чем.
    for (const s of galaxy.filter(isInhabited)) {
      expect(s.planets.length).toBeGreaterThan(0)
      expect(capitalOf(s)).not.toBeNull()
    }
  })

  it('станция бывает только у обитаемого мира', () => {
    for (const s of galaxy) {
      for (const p of s.planets) {
        if (p.station) expect(p.settlement).not.toBeNull()
      }
    }
  })

  it('столица — самый населённый мир системы', () => {
    for (const s of galaxy.filter(isInhabited)) {
      const capital = capitalOf(s)!
      for (const p of settledPlanets(s)) {
        expect(capital.settlement.population).toBeGreaterThanOrEqual(p.settlement.population)
      }
    }
  })

  it('необитаемая система не имеет ни поселений, ни причалов', () => {
    for (const s of galaxy.filter((x) => !isInhabited(x))) {
      expect(settledPlanets(s)).toHaveLength(0)
      expect(stationsOf(s)).toHaveLength(0)
    }
  })

  it('ступень жизни следует за обитаемостью и тех-уровнем, а не задана отдельно', () => {
    // Свойство карты, но правило домена: «нет» тогда и только тогда, когда жить негде;
    // у обитаемых — ступень растёт с САМЫМ развитым миром, а не с первым попавшимся.
    for (const s of galaxy) {
      const life = systemLife(s)
      if (!isInhabited(s)) {
        expect(life).toBe('none')
        continue
      }
      expect(life).not.toBe('none')
      const tech = Math.max(...settledPlanets(s).map((p) => p.settlement.techLevel))
      const expected = tech <= 4 ? 'primitive' : tech <= 9 ? 'developed' : 'advanced'
      expect(life).toBe(expected)
    }
  })

  it('по галактике встречается не одна ступень жизни', () => {
    // Иначе строка на карте — константа и информации не несёт.
    expect(new Set(galaxy.map(systemLife)).size).toBeGreaterThan(1)
  })

  it('тех-уровень растёт от анархии к корпорации', () => {
    // Характеристики коррелированы, а не брошены независимо: иначе получится шум.
    const avg = (gov: string) => {
      const tls = galaxy
        .flatMap(settledPlanets)
        .filter((p) => p.settlement.government === gov)
        .map((p) => p.settlement.techLevel)
      return tls.reduce((a, b) => a + b, 0) / tls.length
    }
    expect(avg('Анархия')).toBeLessThan(avg('Корпорация'))
  })

  it('система выводится из индекса целиком, вместе с местом', () => {
    // Место берётся из отдельного потока бросков, но так же выводится из индекса.
    for (const s of galaxy.slice(0, 50)) {
      expect(placeSystem(s.index)).toEqual({ x: s.x, y: s.y, z: s.z })
    }
  })
})
