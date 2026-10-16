import { describe, expect, it } from 'vitest'
import { GALAXY } from '../../config/galaxy'
import { systemDefFor } from '../galaxy/jump'
import { createWorld } from '../world'
import { stationHost } from './docking'
import { localSettlement } from './trade'
import { SHARED_START_INDEX } from '../galaxy/sharedStart'
import { Quaternion, Vector3 } from 'three'
import { orbitTime, stepOrbits } from '../world/orbits'

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

describe('окрестность едет с игроком', () => {
  // Пойманный баг: местная динамика (трафик, камни) ехала с ПЕРВОЙ станцией системы, а игрок —
  // со своей опорой. У аванпоста с его собственной орбитой всё вокруг проносилось мимо с
  // разницей в сотни километров за такт: корабль «тянуло назад», мир трясло.
  it('у второй станции корабль и камень рядом не уезжают от игрока по орбите', () => {
    const world = createWorld({ ...systemDefFor(SHARED_START_INDEX, GALAXY.SEED), patrols: [], belt: null })
    const stations = world.bodies.filter((b) => b.kind === 'station')
    const outpost = stations[1]!
    expect(stations[0]).not.toBe(outpost)
    const p = world.player
    p.state.pos.copy(outpost.pos).add(new Vector3(0, 0, outpost.radius * 3))
    const ship = world.ships[0] ?? null
    const near = new Vector3(0, 0, 500)
    if (ship) ship.state.pos.copy(p.state.pos).add(near)
    const rock = { id: world.ids.next(), kind: 'asteroid' as const, pos: p.state.pos.clone().add(new Vector3(800, 0, 0)), vel: new Vector3(), quat: new Quaternion(), spin: new Vector3(), radius: 20, hull: 1, shape: 0, alive: true }
    world.asteroids.push(rock)
    const rockRel = rock.pos.clone().sub(p.state.pos)

    stepOrbits(world, orbitTime(world) + 60)

    expect(rock.pos.clone().sub(p.state.pos).distanceTo(rockRel)).toBeLessThan(1)
    if (ship) expect(ship.state.pos.clone().sub(p.state.pos).distanceTo(near)).toBeLessThan(1)
    // И сама станция-опора стоит рядом, как стояла.
    expect(outpost.pos.distanceTo(p.state.pos)).toBeCloseTo(outpost.radius * 3, -1)
  })
})
