import { describe, expect, it } from 'vitest'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import type { ShipEntity } from '../world/entities'
import { rememberPilot } from '../world/acquaintance'
import { giveMielophone } from './divineGift'

/**
 * Дар бога: копию миелофона — каждому, с кем договорился, но ОДИН раз (иначе станок денег),
 * и не тому, на кого гневается.
 */
function withGod(): { world: World; god: ShipEntity } {
  const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [{ count: 1, at: [0, 0, 0], spread: 0, faction: 'neutral', name: 'Слово' }] })
  const god = world.ships[0]!
  god.divine = true
  return { world, god }
}

const mielophones = (w: World) => w.player.hold.items.filter((it) => it.kind === 'module' && it.module.kind === 'mielophone').length

describe('дар бога', () => {
  it('договорились — копия в трюме; второй раз — нет', () => {
    const { world, god } = withGod()
    expect(giveMielophone(world, god)).toBeNull()
    expect(mielophones(world)).toBe(1)
    expect(giveMielophone(world, god)).toBe('given')
    expect(mielophones(world)).toBe(1)
  })

  it('продал подаренный — новый не выпросишь', () => {
    const { world, god } = withGod()
    giveMielophone(world, god)
    world.player.hold.items = world.player.hold.items.filter((it) => it.kind !== 'module')
    expect(giveMielophone(world, god)).toBe('given')
  })

  it('во гневе бог не дарит', () => {
    const { world, god } = withGod()
    rememberPilot(world, god)
    world.acquaintances.find((a) => a.id === god.acquaintanceId)!.relationship = 'hostile'
    expect(giveMielophone(world, god)).toBe('hostile')
    expect(mielophones(world)).toBe(0)
  })

  it('обычный пилот миелофонов не раздаёт', () => {
    const { world, god } = withGod()
    god.divine = false
    expect(giveMielophone(world, god)).toBe('not-god')
  })
})

describe('миелофон — только дар', () => {
  it('ни на одной станции галактики его не продают и с обломков он не падает', async () => {
    const { stationStock } = await import('../station/shop')
    const { MIELOPHONE_DEVICE } = await import('../../config/modules')
    expect(MIELOPHONE_DEVICE.salvageChance).toBe(0)
    for (let sys = 0; sys < 200; sys++) {
      const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
      world.systemIndex = sys
      expect(stationStock(world).some((m) => m.kind === 'mielophone')).toBe(false)
    }
  })
})
