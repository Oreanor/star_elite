import { describe, expect, it } from 'vitest'
import { createWorld, STARTER_SYSTEM } from '@elite/sim'
import { decodeShip, encodeShip, missileTargetRef, rosterOf } from './trafficWire'

/**
 * Провод общего трафика: поза уходит АБСОЛЮТНОЙ (плавающее начало у каждого своё) и
 * возвращается той же с точностью до округления; цель ракеты — игрок по uid, бот по id.
 */
describe('провод общего трафика', () => {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, 0], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  const ship = world.ships[0]!

  it('поза туда и обратно — в абсолютном кадре', () => {
    world.originOffset.set(1e9, -2e8, 5e7)
    ship.state.pos.set(1234.56, -78.9, 42)
    ship.state.vel.set(10, 20, 30)
    const d = decodeShip(encodeShip(ship, world))!
    expect(d.x).toBeCloseTo(1e9 + 1234.6, 0)
    expect(d.y).toBeCloseTo(-2e8 - 78.9, 0)
    expect(d.vz).toBe(30)
    expect(d.hull).toBeCloseTo(1, 2)
  })

  it('битый пакет не разбирается', () => {
    expect(decodeShip([1, 2, 3])).toBeNull()
    expect(decodeShip([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, Number.NaN])).toBeNull()
  })

  it('цель ракеты: свой игрок — по uid, прочее — как назовёт владелец', () => {
    expect(missileTargetRef(world.player.id, world, 'me', () => null)).toBe('u:me')
    expect(missileTargetRef(77, world, 'me', (id) => (id === 77 ? 'u:friend' : null))).toBe('u:friend')
    expect(missileTargetRef(ship.id, world, 'me', (id) => `h:me:${id}`)).toBe(`h:me:${ship.id}`)
    expect(missileTargetRef(null, world, 'me', () => null)).toBeNull()
  })

  it('реестр помечает погибшего', () => {
    expect(rosterOf(ship, true).d).toBeUndefined()
    ship.alive = false
    expect(rosterOf(ship, true).d).toBe(1)
    ship.alive = true
  })
})
