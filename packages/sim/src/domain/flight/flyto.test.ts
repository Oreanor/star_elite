import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { AUTOPILOT } from '../../config/station'
import { createWorld, STARTER_SYSTEM } from '../world'
import { canEngageFlyTo, flyToArrived, flyToController } from './flyto'

/**
 * Автопилот-к-цели — ОБЫЧНЫЙ Controller: без рендера, без ввода. Проверяем СВОЙСТВА
 * (тянется к далёкой цели полным ходом, глохнет у близкой, доворачивает нос, отпускает
 * штурвал по прибытии), а не конкретные числа — они переживут перебалансировку AUTOPILOT.
 */
function withTarget(dist: number, side = 0) {
  // Патрулём спавним один борт-цель; координаты патруля мировые, поэтому цель ставим
  // относительно игрока (он в астроединице от начала координат).
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, 0], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  world.docked = false
  const target = world.ships[0]
  if (!target) throw new Error('нужен борт-цель в мире')
  // Цель на известном удалении от игрока, с боковым сносом — чтобы был повод доворачивать.
  target.state.pos.copy(world.player.state.pos).add(new Vector3(side, 0, -dist))
  world.lockedTargetId = target.id
  world.lockedStationId = null
  return { world, target }
}

describe('автопилот-к-цели', () => {
  it('дотянется только к захваченному живому борту и не в доке', () => {
    const { world, target } = withTarget(5000)
    expect(canEngageFlyTo(world)).toBe(true)

    world.lockedTargetId = null
    expect(canEngageFlyTo(world)).toBe(false) // нечего вести

    world.lockedTargetId = target.id
    world.docked = true
    expect(canEngageFlyTo(world)).toBe(false) // в доке не летают
  })

  it('к далёкой цели идёт полным ходом, у близкой глохнет', () => {
    const far = withTarget(20_000)
    flyToController.update(far.world.player, far.world, 0.016)
    expect(far.world.player.controls.throttle).toBeGreaterThan(0.5)

    const near = withTarget(AUTOPILOT.ARRIVE_RANGE - 100)
    flyToController.update(near.world.player, near.world, 0.016)
    expect(near.world.player.controls.throttle).toBe(0)
  })

  it('цель в стороне — автопилот доворачивает нос (тангаж или рыскание ненулевые)', () => {
    const { world } = withTarget(6000, 4000) // сильный боковой снос
    flyToController.update(world.player, world, 0.016)
    const c = world.player.controls
    expect(Math.abs(c.pitch) + Math.abs(c.yaw)).toBeGreaterThan(0)
  })

  it('прибытие: у цели — «долетел», вдали — нет, цель пропала — тоже «долетел»', () => {
    const { world, target } = withTarget(AUTOPILOT.ARRIVE_RANGE - 50)
    expect(flyToArrived(world)).toBe(true)

    target.state.pos.copy(world.player.state.pos).add(new Vector3(0, 0, -10_000))
    expect(flyToArrived(world)).toBe(false)

    world.lockedTargetId = null // цель снята — вести некуда, штурвал возвращаем
    expect(flyToArrived(world)).toBe(true)
  })
})
