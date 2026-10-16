import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { systemDefFor } from '../galaxy/jump'
import { createWorld } from '../world'
import { stationHost } from './docking'
import { localSettlement } from './trade'
import { SHARED_START_INDEX } from '../galaxy/sharedStart'

/**
 * «Где я» у причала — планета ЭТОЙ станции. Станций в системе по одной на населённый мир,
 * и прежде консоль брала столицу: у аванпоста «Саррэль» шапка писала чужую планету, а
 * вкладка ПЛАНЕТА показывала Кориолис столицы. Держим инвариант, на котором это стоит.
 */
describe('станция и её планета', () => {
  it('у каждой станции есть хозяин — обитаемый мир, и у разных станций свои', () => {
    let checked = 0
    for (let index = 0; index < 40; index++) {
      const world = createWorld({ ...systemDefFor(index, GALAXY.SEED), patrols: [], belt: null })
      const stations = world.bodies.filter((b) => b.kind === 'station')
      const hosts = new Set<number>()
      for (const station of stations) {
        // «Крест» — монумент Слова, нарочно вне орбит; прочие причалы — у своих миров.
        if (station.stationStyle === 'cross') continue
        const host = stationHost(world, station)
        expect(host, `${world.systemName}: ${station.name}`).not.toBeNull()
        expect(host!.population).toBeGreaterThan(0)
        hosts.add(host!.id)
        checked++
      }
      // Две станции у одной планеты не висят: иначе «планета станции» снова неоднозначна.
      expect(hosts.size).toBe(stations.filter((s) => s.stationStyle !== 'cross').length)
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('рынок причала', () => {
  // Пойманный баг: рынок брался у столицы системы при любом причале — у аванпоста аграрной
  // планеты торговля/верфь/ремонт шли по ценам и техом столицы, а ПЛАНЕТА и штрафы — по своей.
  it('у каждого причала рынок — поселение его планеты, а не столицы', () => {
    const world = createWorld({ ...systemDefFor(SHARED_START_INDEX, GALAXY.SEED), patrols: [], belt: null })
    const stations = world.bodies.filter((b) => b.kind === 'station' && stationHost(world, b))
    expect(stations.length).toBeGreaterThanOrEqual(2)
    for (const station of stations) {
      world.player.state.pos.copy(station.pos)
      const own = stationHost(world, station)!.settlement
      expect(own).not.toBeNull()
      expect(localSettlement(world)).toBe(own)
    }
  })
})
