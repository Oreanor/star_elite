import { describe, expect, it } from 'vitest'
import { FIGURINE, FIGURINE_TITLES } from '../../config/figurines'
import { addItem } from '../cargo/hold'
import { COMMODITIES, itemMass } from '../cargo/items'
import { createWorld } from './factory'
import {
  canAttractFigurine,
  placeFigurineFromHold,
  placeFigurines,
  tryScoopFigurine,
} from './figurines'
import { STARTER_SYSTEM } from './system'

describe('коллекционные статуэтки', () => {
  it('в системе 1–2 живых статуэтки, размер в диапазоне', () => {
    const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    expect(world.figurines.length).toBeGreaterThanOrEqual(FIGURINE.COUNT_MIN)
    expect(world.figurines.length).toBeLessThanOrEqual(FIGURINE.COUNT_MAX)
    for (const f of world.figurines) {
      expect(f.alive).toBe(true)
      expect(f.radius).toBeGreaterThanOrEqual(FIGURINE.RADIUS_MIN)
      expect(f.radius).toBeLessThanOrEqual(FIGURINE.RADIUS_MAX)
    }
  })

  it('расстановка детерминирована сидом системы', () => {
    const a = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    const b = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    expect(a.figurines.map((f) => [f.radius, f.pos.x, f.pos.z])).toEqual(
      b.figurines.map((f) => [f.radius, f.pos.x, f.pos.z]),
    )
  })

  it('не садится на планету в момент размещения', () => {
    const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    for (const f of world.figurines) {
      for (const body of world.bodies) {
        if (body.kind !== 'planet' && body.kind !== 'moon' && body.kind !== 'station') continue
        const min = body.radius + f.radius * FIGURINE.ORBIT_CLEARANCE
        expect(f.pos.distanceTo(body.pos)).toBeGreaterThan(min)
      }
    }
  })

  it('притянуть можно только в окне размера 1×…10×', () => {
    const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    placeFigurines(world)
    const fig = world.figurines[0]
    expect(fig).toBeDefined()
    const ship = world.player
    const hull = ship.spec.hull.radius

    ship.state.scale = (fig!.radius * 0.5) / hull
    expect(canAttractFigurine(ship, fig!)).toBe(false)

    ship.state.scale = (fig!.radius * 1.5) / hull
    expect(canAttractFigurine(ship, fig!)).toBe(true)

    ship.state.scale = (fig!.radius * FIGURINE.SCOOP_MAX_SCALE) / hull
    expect(canAttractFigurine(ship, fig!)).toBe(false)
  })

  it('подбор кладёт статуэтку в трюм с массой 0 и сохраняет имя', () => {
    const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    const fig = world.figurines[0]!
    const ship = world.player
    ship.state.scale = (fig.radius * 2) / ship.spec.hull.radius
    ship.state.pos.copy(fig.pos)

    expect(tryScoopFigurine(ship, fig)).toBe(true)
    expect(fig.alive).toBe(false)
    const stack = ship.hold.items.find(
      (i) => i.kind === 'commodity' && i.commodity.id === COMMODITIES.FIGURINE.id,
    )
    expect(stack).toBeDefined()
    expect(itemMass(stack!)).toBe(0)
    expect(stack!.kind === 'commodity' && stack.specimens?.[0]?.titleId).toBe(fig.titleId)
  })

  it('у мировой статуэтки есть titleId из каталога', () => {
    const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    for (const f of world.figurines) {
      expect(FIGURINE_TITLES.some((t) => t.id === f.titleId)).toBe(true)
    }
  })

  it('Слово — главный коллекционер: полный каталог в трюме', () => {
    const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    const slovo = world.ships.find((s) => s.divine)
    expect(slovo).toBeDefined()
    expect(slovo!.persona.figurineHobby?.zeal).toBe(1)
    const titles = new Set(
      slovo!.hold.items
        .filter((i) => i.kind === 'commodity' && i.commodity.id === COMMODITIES.FIGURINE.id)
        .flatMap((i) => (i.kind === 'commodity' ? (i.specimens ?? []).map((s) => s.titleId) : [])),
    )
    expect(titles.size).toBe(FIGURINE_TITLES.length)
    for (const t of FIGURINE_TITLES) expect(titles.has(t.id)).toBe(true)
  })

  it('выкладка ставит статуэтку в 3–5 км по носу', () => {
    const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    // Убрать системные статуэтки — иначе зазор/пересечение с ними режет попытку.
    world.figurines = []
    const ship = world.player
    const star = world.bodies.find((b) => b.kind === 'star')!
    // Далеко от звезды и планет: иначе «нет места» / пересечение.
    ship.state.pos.set(star.pos.x + star.radius * 40, 0, star.pos.z)
    ship.state.quat.identity()

    expect(
      addItem(ship.hold, { kind: 'commodity', commodity: COMMODITIES.FIGURINE, units: 1 }),
    ).toBe(true)
    const before = world.figurines.length
    const index = ship.hold.items.findIndex(
      (i) => i.kind === 'commodity' && i.commodity.id === COMMODITIES.FIGURINE.id,
    )
    expect(placeFigurineFromHold(world, ship, index)).toBe('ok')
    expect(world.figurines.length).toBe(before + 1)
    const placed = world.figurines[world.figurines.length - 1]!
    const ahead = ship.state.pos.distanceTo(placed.pos)
    expect(ahead).toBeGreaterThanOrEqual(FIGURINE.DEPLOY_AHEAD_MIN)
    expect(ahead).toBeLessThanOrEqual(FIGURINE.DEPLOY_AHEAD_MAX)
    // Identity quat: нос = −Z.
    expect(placed.pos.z).toBeCloseTo(ship.state.pos.z - ahead, 3)
  })

  it('пересечение с уже стоящей статуэткой режет попытку молча', () => {
    const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    world.figurines = []
    const ship = world.player
    const star = world.bodies.find((b) => b.kind === 'star')!
    ship.state.pos.set(star.pos.x + star.radius * 40, 0, star.pos.z)
    ship.state.quat.identity()

    addItem(ship.hold, { kind: 'commodity', commodity: COMMODITIES.FIGURINE, units: 2 })
    const index = ship.hold.items.findIndex(
      (i) => i.kind === 'commodity' && i.commodity.id === COMMODITIES.FIGURINE.id,
    )
    expect(placeFigurineFromHold(world, ship, index)).toBe('ok')
    // Вторая в ту же точку по носу — объёмы пересекаются.
    expect(placeFigurineFromHold(world, ship, index)).toBe('blocked')
    const stack = ship.hold.items.find(
      (i) => i.kind === 'commodity' && i.commodity.id === COMMODITIES.FIGURINE.id,
    )
    expect(stack?.kind === 'commodity' && stack.units).toBe(1)
  })

  it('у звезды слишком близко — no-room, трюм цел', () => {
    const world = createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
    world.figurines = []
    const ship = world.player
    const star = world.bodies.find((b) => b.kind === 'star')!
    // Чуть за фотосферой, но внутри minOrbit — зазор, не жёсткое пересечение с звездой.
    ship.state.pos.set(star.pos.x + star.radius * 2.5, 0, star.pos.z)
    ship.state.quat.identity()

    addItem(ship.hold, { kind: 'commodity', commodity: COMMODITIES.FIGURINE, units: 1 })
    const index = ship.hold.items.findIndex(
      (i) => i.kind === 'commodity' && i.commodity.id === COMMODITIES.FIGURINE.id,
    )
    expect(placeFigurineFromHold(world, ship, index)).toBe('no-room')
    expect(
      ship.hold.items.some(
        (i) => i.kind === 'commodity' && i.commodity.id === COMMODITIES.FIGURINE.id,
      ),
    ).toBe(true)
  })
})
