import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { MIELOPHONE } from '../../config/mielophone'
import { MIELOPHONE_DEVICE } from '../../config/modules'
import { stepWorld } from '../sim'
import { createWorld, refreshSpec, STARTER_SYSTEM } from '../world'
import type { ShipEntity, World } from '../world/entities'
import { effectiveMass, effectiveRadius, stepScale } from './scale'

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

    // Долгий рост упирается в потолок, а не уходит в бесконечность.
    p.controls.grow = 1
    for (let i = 0; i < 100; i++) stepScale(p, 1)
    expect(p.state.scale).toBe(MIELOPHONE.MAX_SCALE)
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

  it('гигант давит мелочь при касании, а сам почти цел', () => {
    const { world, bot } = withBot()
    const p = world.player

    // Игрок вырос и стоит вплотную к боту — их силуэты пересекаются.
    p.state.scale = 50
    p.state.pos.set(0, 0, 0)
    p.state.vel.set(0, 0, -60) // наезжает на бота
    bot.state.pos.set(0, 0, -80) // в пределах эффективного радиуса гиганта
    bot.state.vel.set(0, 0, 0)
    const pHullBefore = p.hull

    // Пустые контроллеры: никто не рулит, движение — только инерция и столкновение.
    for (let i = 0; i < 30 && bot.alive; i++) stepWorld(world, 1 / 60, new Map())

    expect(bot.alive).toBe(false) // мелочь раздавлена
    expect(p.alive).toBe(true) // гигант цел
    // Гигант почти не пострадал: щит если и тронут, то корпус — точно нет.
    expect(p.hull).toBe(pHullBefore)
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
