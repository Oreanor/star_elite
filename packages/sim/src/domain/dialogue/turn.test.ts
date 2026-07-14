import { describe, expect, it } from 'vitest'
import { createWorld, STARTER_SYSTEM, rememberPilot } from '../world'
import { dialogueEffects } from './turn'

describe('dialogueEffects', () => {
  it('кнопка приказа без replyText — берёт spoken из домена', () => {
    const world = createWorld({
      ...STARTER_SYSTEM,
      belt: null,
      patrols: [{ count: 1, at: [0, 0, -200], spread: 0, faction: 'neutral', name: 'Эскорт' }],
    })
    const ship = world.ships[0]!
    rememberPilot(world, ship)
    ship.ai!.escortOf = world.player.id

    const fx = dialogueEffects(world, ship, [{ action: 'order', payload: { order: 'hold' } }], '')

    expect(fx.them).toBe('ЕСТЬ, КОМАНДИР.')
    expect(fx.system[0]).toContain('ждать')
  })

  it('поручение collect через task — spoken без модели', () => {
    const world = createWorld({
      ...STARTER_SYSTEM,
      belt: null,
      patrols: [{ count: 1, at: [0, 0, -200], spread: 0, faction: 'neutral', name: 'Эскорт' }],
    })
    const ship = world.ships[0]!
    rememberPilot(world, ship)
    ship.ai!.escortOf = world.player.id

    const fx = dialogueEffects(
      world,
      ship,
      [{ action: 'task', payload: { kind: 'collect-cargo', radius: 4000 } }],
      '',
    )

    expect(fx.them).toContain('СОБИРАЮ')
    expect(ship.ai!.tasks.length).toBeGreaterThan(0)
  })
})
