import { describe, expect, it } from 'vitest'
import { createWorld, STARTER_SYSTEM, type World } from '.'
import { cycleTarget, targetablesOf } from './queries'

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
