import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { MIELOPHONE } from '../../config/mielophone'
import { MIELOPHONE_DEVICE } from '../../config/modules'
import { stepWorld } from '../sim'
import { createWorld, refreshSpec, STARTER_SYSTEM } from '../world'
import type { ShipEntity, World } from '../world/entities'
import {
  effectiveMass,
  effectiveRadius,
  metersPerLy,
  preserveGalaxyLocus,
  speedScaleFactor,
  stepScale,
} from './scale'

/** Локус в св.г по X от якоря (для тестов инварианта зума). */
function locusX(ship: ShipEntity, world: World): number {
  const anchor = world.galaxyAnchorTrue
    ? world.galaxyAnchorTrue.clone().sub(world.originOffset)
    : new Vector3()
  return (ship.state.pos.x - anchor.x) / metersPerLy(ship.state.scale)
}

/** Мир с одним мелким ботом рядом с игроком; поясов/станций нет — чистая сцена. */
function withBot(): { world: World; bot: ShipEntity } {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    station: null,
    patrols: [{ count: 1, at: [0, 0, -100], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  return { world, bot: world.ships[0]! }
}

/** Поставить миелофон в слот: без устройства борт не растёт (право на масштаб — от него). */
function fitMielophone(ship: ShipEntity): void {
  ship.loadout.internals.push(MIELOPHONE_DEVICE)
  refreshSpec(ship)
}

describe('миелофон: масштаб', () => {
  it('без устройства сигнал grow НЕ растит: право на масштаб даёт модуль', () => {
    const { world } = withBot()
    const p = world.player
    expect(p.spec.hasMielophone).toBe(false)

    p.controls.grow = 1
    stepScale(p, 1)
    expect(p.state.scale).toBe(1) // нет миелофона — рост игнорируется
  })

  it('сигнал grow растит масштаб (с устройством), а его отсутствие держит', () => {
    const { world } = withBot()
    const p = world.player
    fitMielophone(p)
    expect(p.state.scale).toBe(1)

    p.controls.grow = 1
    stepScale(p, 1)
    expect(p.state.scale).toBeGreaterThan(1)

    const held = p.state.scale
    p.controls.grow = 0
    stepScale(p, 1)
    expect(p.state.scale).toBe(held) // без сигнала — держится
  })

  it('масштаб зажат снизу единицей и сверху потолком', () => {
    const { world } = withBot()
    const p = world.player
    fitMielophone(p)

    // Усадка ниже 1 невозможна: миелофон только растит.
    p.controls.grow = -1
    stepScale(p, 5)
    expect(p.state.scale).toBe(MIELOPHONE.MIN_SCALE)

    // Долгий рост упирается в потолок, а не уходит в бесконечность. Аукс подзаряжаем
    // вручную каждый шаг — иначе рост встал бы на пустой батарее раньше потолка.
    p.controls.grow = 1
    for (let i = 0; i < 100; i++) {
      p.auxEnergy = p.spec.power.auxCapacity
      stepScale(p, 1)
    }
    expect(p.state.scale).toBe(MIELOPHONE.MAX_SCALE)
  })

  it('рост ТРАТИТ батарею доп-отсека и встаёт на нуле заряда', () => {
    const { world } = withBot()
    const p = world.player
    fitMielophone(p)
    p.auxEnergy = p.spec.power.auxCapacity
    expect(p.state.scale).toBe(1)

    // Растём, пока не иссякнет аукс (полного заряда хватает примерно на ×GROW_FULL_FACTOR).
    p.controls.grow = 1
    for (let i = 0; i < 50; i++) stepScale(p, 1)
    expect(p.auxEnergy).toBe(0) // доп-отсек выкачан ростом
    expect(p.state.scale).toBeGreaterThan(1)

    const stalled = p.state.scale
    stepScale(p, 1)
    expect(p.state.scale).toBe(stalled) // без заряда рост не идёт — жди подзарядки
  })

  it('радиус и масса растут с масштабом: масса — кубом (объём)', () => {
    const { world } = withBot()
    const p = world.player
    const r0 = effectiveRadius(p)
    const m0 = effectiveMass(p)

    p.state.scale = 10
    expect(effectiveRadius(p)).toBeCloseTo(r0 * 10, 5)
    expect(effectiveMass(p)).toBeCloseTo(m0 * 1000, 5) // 10^3
  })

  it('при scale>1 борта сквозные: гигант не давит мелочь (твердь — только Shift+Tab)', () => {
    const { world, bot } = withBot()
    const p = world.player

    p.state.scale = 20
    p.state.pos.set(0, 0, 0)
    p.state.vel.set(0, 0, -60)
    bot.state.pos.set(0, 0, -40)
    bot.state.vel.set(0, 0, 0)
    const botHull = bot.hull

    for (let i = 0; i < 30; i++) stepWorld(world, 1 / 60, new Map())

    expect(bot.alive).toBe(true)
    expect(bot.hull).toBe(botHull)
    expect(p.alive).toBe(true)
  })

  it('обычные корабли (масштаб 1) друг о друга не бьются — остаются сквозными', () => {
    const { world, bot } = withBot()
    const p = world.player

    // Оба обычного размера и наложены друг на друга — раньше проходили насквозь.
    p.state.scale = 1
    bot.state.scale = 1
    p.state.pos.set(0, 0, 0)
    bot.state.pos.set(0, 0, 5) // ближе суммы радиусов
    const botHull = bot.hull
    const pHull = p.hull

    for (let i = 0; i < 30; i++) stepWorld(world, 1 / 60, new Map())

    // Никакого столкновения: оба целы и урона нет.
    expect(bot.alive).toBe(true)
    expect(p.alive).toBe(true)
    expect(bot.hull).toBe(botHull)
    expect(p.hull).toBe(pHull)
  })
})

describe('миелофон: скорость', () => {
  it('множитель скорости равен масштабу (не ниже 1)', () => {
    expect(speedScaleFactor(1)).toBe(1)
    expect(speedScaleFactor(0.5)).toBe(1)
    expect(speedScaleFactor(1e7)).toBe(1e7)
  })

  it('рост без тяги не надувает скорость; сжатие снимает гиперскорость', () => {
    const { world } = withBot()
    const p = world.player
    fitMielophone(p)
    p.state.scale = 100
    p.state.vel.set(0, 0, -5000)
    p.controls.throttle = 0
    p.controls.grow = 1
    p.auxEnergy = p.spec.power.auxCapacity
    const before = p.state.vel.length()
    stepScale(p, 0.5)
    expect(p.state.scale).toBeGreaterThan(100)
    // Без газа рост не размножает vel — иначе спидометр сам взлетает.
    expect(p.state.vel.length()).toBeCloseTo(before, 5)

    p.state.scale = 10_000
    p.state.vel.set(0, 0, -1e7)
    p.controls.grow = -1
    stepScale(p, 1)
    expect(p.state.scale).toBeLessThan(10_000)
    // Сжатие пропорционально гасит скорость под новый потолок.
    expect(p.state.vel.length()).toBeLessThan(1e7)
  })

  it('рост с газом сохраняет долю от потолка', () => {
    const { world } = withBot()
    const p = world.player
    fitMielophone(p)
    p.state.scale = 10
    p.state.vel.set(0, 0, -1000) // доля от потолка при scale=10
    p.controls.throttle = 1
    p.controls.grow = 1
    p.auxEnergy = p.spec.power.auxCapacity
    const oldF = speedScaleFactor(p.state.scale)
    const oldV = p.state.vel.length()
    stepScale(p, 0.5)
    const newF = speedScaleFactor(p.state.scale)
    expect(p.state.vel.length() / oldV).toBeCloseTo(newF / oldF, 5)
  })
})

describe('миелофон: галактический локус', () => {
  /** Мир с якорем в нуле и бортом на заданном ly при GHOST_BODY. */
  function atLy(ly: number): { world: World; player: ShipEntity; s0: number } {
    const { world } = withBot()
    const player = world.player
    fitMielophone(player)
    world.originOffset.set(0, 0, 0)
    world.galaxyAnchorTrue = new Vector3(0, 0, 0)
    const s0 = MIELOPHONE.GHOST_BODY_SCALE
    player.state.scale = s0
    player.state.pos.set(ly * metersPerLy(s0), 0, 0)
    player.state.vel.set(0, 0, 0)
    return { world, player, s0 }
  }

  it('зум на месте сохраняет локус в св.г (не уползаешь к чужой звезде)', () => {
    const { world, player, s0 } = atLy(0.5)
    const before = locusX(player, world)

    const s1 = s0 * 10_000
    preserveGalaxyLocus(player, world, s0, s1)
    player.state.scale = s1

    expect(locusX(player, world)).toBeCloseTo(before, 8)
    expect(locusX(player, world)).toBeCloseTo(0.5, 8)
  })

  it('после «полёта» усадка держит НОВЫЙ локус, не старый', () => {
    const { world, player, s0 } = atLy(0.5)
    // Выросли, потом «перелетели» на +1 св.г — локус обновил pos, не зум.
    const sHi = s0 * 100
    player.state.scale = sHi
    player.state.pos.set(1.5 * metersPerLy(sHi), 0, 0)
    expect(locusX(player, world)).toBeCloseTo(1.5, 8)

    const s1 = s0 * 10
    preserveGalaxyLocus(player, world, sHi, s1)
    player.state.scale = s1

    expect(locusX(player, world)).toBeCloseTo(1.5, 8)
  })

  it('ниже GHOST_BODY зум не тянет к якорю (системные метры)', () => {
    const { world } = withBot()
    const p = world.player
    fitMielophone(p)
    world.galaxyAnchorTrue = new Vector3(0, 0, 0)
    world.originOffset.set(0, 0, 0)
    p.state.scale = 10
    p.state.pos.set(12_000, 0, 0)
    preserveGalaxyLocus(p, world, 10, 100)
    expect(p.state.pos.x).toBe(12_000)
  })

  it('stepScale с world сам сохраняет локус при усадке', () => {
    const { world, player, s0 } = atLy(0.75)
    player.state.scale = s0 * 100
    player.state.pos.set(0.75 * metersPerLy(player.state.scale), 0, 0)
    const before = locusX(player, world)

    player.controls.grow = -1
    stepScale(player, 1, world)
    expect(player.state.scale).toBeLessThan(s0 * 100)
    expect(locusX(player, world)).toBeCloseTo(before, 6)
  })
})
