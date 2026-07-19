import { describe, expect, it } from 'vitest'
import { MIELOPHONE } from '../../config/mielophone'
import { createWorld, STARTER_SYSTEM, type World } from '.'
import { cycleCelestial, cycleTarget, pruneGiantScaleLocks, targetablesOf } from './queries'

/** Мир с пиратом и нейтралом перед носом игрока. */
function withPirateAndNeutral(): World {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [
      { count: 1, at: [0, 0, -200], spread: 0, faction: 'hostile', name: 'Пират' },
      { count: 1, at: [0, 0, -220], spread: 0, faction: 'neutral', name: 'Торговец' },
    ],
  })
  world.player.state.pos.set(0, 0, 0)
  // Нос смотрит на −Z, где стоят оба борта.
  return world
}

describe('захват цели берёт любую фракцию', () => {
  // Баг: Tab переключался только между враждебными, и с нейтралом (у станции)
  // нельзя было заговорить — курсор до него не доходил. Захват — «на кого смотрю»,
  // а не «кого бью», поэтому нейтрал обязан попадать в перебор.
  it('Tab доходит до нейтрала, а не залипает на пирате', () => {
    const world = withPirateAndNeutral()

    const factions = targetablesOf(world).map((s) => s.faction).sort()
    expect(factions).toEqual(['hostile', 'neutral'])

    // Обход по кругу обязан посетить обе фракции за два нажатия.
    const first = cycleTarget(world, null)
    const second = cycleTarget(world, first)
    const visited = new Set([first, second].map((id) => {
      return world.ships.find((s) => s.id === id)?.faction
    }))
    expect(visited.has('neutral')).toBe(true)
    expect(visited.has('hostile')).toBe(true)
  })
})

describe('гигантский масштаб гасит системный нав', () => {
  // Баг: выше GHOST_BODY HUD ещё рисовал рамку Кориолиса / планеты в пустоте —
  // захват жил, а тела уже не для приборов. Остаются только звезда и дыра.
  it('prune снимает станцию и оставляет звезду', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    const station = world.bodies.find((b) => b.kind === 'station')
    const star = world.bodies.find((b) => b.kind === 'star')
    expect(station).toBeTruthy()
    expect(star).toBeTruthy()

    world.navTargetId = station!.id
    world.lockedStationId = station!.id
    world.player.state.scale = MIELOPHONE.GHOST_BODY_SCALE
    pruneGiantScaleLocks(world)
    expect(world.navTargetId).toBeNull()
    expect(world.lockedStationId).toBeNull()

    world.navTargetId = star!.id
    pruneGiantScaleLocks(world)
    expect(world.navTargetId).toBe(star!.id)
  })

  it('с PHASE_END снимает захват борта — корабли уже растворились', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    const other = world.ships.find((s) => s.id !== world.player.id) ?? world.ships[0]
    // Если патрулей нет — подставим фиктивный id; prune всё равно гасит контактный захват.
    world.lockedTargetId = other?.id ?? 99
    world.targetFocus = 'contact'
    world.player.state.scale = MIELOPHONE.PHASE_END
    pruneGiantScaleLocks(world)
    expect(world.lockedTargetId).toBeNull()
  })

  it('Shift+Tab выше GHOST_BODY берёт только звезду/дыру', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    world.player.state.scale = MIELOPHONE.GHOST_BODY_SCALE
    cycleCelestial(world)
    const nav = world.bodies.find((b) => b.id === world.navTargetId)
    expect(nav?.kind === 'star' || nav?.kind === 'blackhole').toBe(true)
  })

  it('звезда переживает рост через GHOST_BODY', () => {
    const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
    const star = world.bodies.find((b) => b.kind === 'star')
    expect(star).toBeTruthy()
    world.navTargetId = star!.id
    world.targetFocus = 'nav'

    for (const scale of [1, 1e3, MIELOPHONE.GHOST_BODY_SCALE, 1e6, MIELOPHONE.MAX_SCALE, 1e4, 1]) {
      world.player.state.scale = scale
      pruneGiantScaleLocks(world)
      expect(world.navTargetId).toBe(star!.id)
      expect(world.targetFocus).toBe('nav')
    }
  })
})
