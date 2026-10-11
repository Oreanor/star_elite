import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { AI } from '../../config/ai'
import { createWorld, STARTER_SYSTEM } from '../world'
import { stepWorld } from '../sim'
import { lockContact } from '../world/queries'
import type { BodyEntity } from '../world/entities'
import { engageAutofight } from './autofight'
import { avoidBodies } from './maneuvers'
import { aiController } from './pilot'

/**
 * Облёт тел ботом. Регрессия: автобой гнался по прямой, упирался в станцию между игроком и
 * целью и так и висел — газ 0.85, скорость ноль, цель в 2 км. Бот обязан огибать тело.
 */
describe('облёт тел', () => {
  const body = { pos: new Vector3(0, 0, -1000), radius: 300 } as BodyEntity

  it('тело на пути уводит точку руления за его сферу запаса', () => {
    const out = avoidBodies(new Vector3(0, 0, 0), new Vector3(0, 0, -3000), [body], new Vector3())
    const clear = body.radius + AI.AVOID_MARGIN + body.radius * AI.AVOID_MARGIN_FRAC
    expect(out.distanceTo(body.pos)).toBeGreaterThan(clear)
  })

  it('путь чист — точка руления та же, что цель', () => {
    const aim = new Vector3(5000, 0, -3000)
    const out = avoidBodies(new Vector3(0, 0, 0), aim, [body], new Vector3())
    expect(out.distanceTo(aim)).toBeLessThan(1e-6)
  })

  it('автобой через станцию не замирает у её борта', () => {
    const world = createWorld({
      ...STARTER_SYSTEM,
      belt: null,
      patrols: [{ count: 1, at: [0, 0, 0], spread: 0, faction: 'hostile', name: 'Пират' }],
    })
    const enemy = world.ships[0]!
    const station = world.bodies.find((b) => b.kind === 'station')!
    // Враг ровно за станцией: прямая игрок → враг проходит сквозь её корпус.
    const through = station.pos.clone().sub(world.player.state.pos).normalize()
    enemy.state.pos.copy(station.pos).addScaledVector(through, station.radius + 600)
    lockContact(world, 'ship', enemy.id)
    world.targetFocus = 'contact'
    expect(engageAutofight(world)).toBe(true)

    const controllers = new Map([[world.player.id, aiController]])
    // Прежде за 10 с корабль вставал у борта и дальше не двигался. Теперь он обязан
    // всё это время лететь: средняя скорость за последние 10 из 20 с — заметно не ноль.
    let path = 0
    const last = new Vector3()
    for (let i = 0; i < 20 * 60; i++) {
      if (i === 10 * 60) last.copy(world.player.state.pos)
      if (i > 10 * 60) {
        path += world.player.state.pos.distanceTo(last)
        last.copy(world.player.state.pos)
      }
      stepWorld(world, 1 / 60, controllers, { unassigned: aiController })
      if (!enemy.alive) return
    }
    expect(path / 10).toBeGreaterThan(30) // м/с
  })
})
