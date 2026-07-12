import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { GUNNERY } from '../../config/weapons'
import { createWorld, STARTER_SYSTEM } from '../world'
import { leadPoint } from './maneuvers'

/**
 * Упреждение стрельбы под скорость БОЛТА. Лазер стал снарядом, и нос бота ведётся не
 * в цель, а туда, где она окажется за время полёта болта (`pilot.ts`, режим attack).
 * Проверяем сам закон: точка упреждения смещена ВПЕРЁД по ходу цели ровно на v·(d/BOLT_SPEED).
 */
function twoShips() {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -1000], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  return { shooter: world.player, target: world.ships[0]! }
}

describe('упреждение стрельбы', () => {
  it('целится ВПЕРЁД цели, идущей поперёк, на время полёта болта', () => {
    const { shooter, target } = twoShips()
    const D = 1000
    shooter.state.pos.set(0, 0, 0)
    shooter.state.vel.set(0, 0, 0)
    target.state.pos.set(0, 0, -D)
    target.state.vel.set(150, 0, 0) // строго поперёк линии визирования

    const aim = leadPoint(shooter, target, GUNNERY.BOLT_SPEED, new Vector3())

    // Точка упреждения — впереди цели по её ходу (+X), а не в самой цели.
    expect(aim.x).toBeGreaterThan(0)
    // И ровно на снос за время полёта: t ≈ d/скорость болта (болт много быстрее цели).
    const flight = D / GUNNERY.BOLT_SPEED
    expect(aim.x).toBeCloseTo(150 * flight, 0)
  })

  it('по неподвижной цели упреждение вырождается в саму цель', () => {
    const { shooter, target } = twoShips()
    shooter.state.pos.set(0, 0, 0)
    shooter.state.vel.set(0, 0, 0)
    target.state.pos.set(0, 0, -800)
    target.state.vel.set(0, 0, 0)

    const aim = leadPoint(shooter, target, GUNNERY.BOLT_SPEED, new Vector3())
    // Стоит на месте — целиться некуда, кроме как в неё: сноса нет.
    expect(aim.x).toBeCloseTo(0, 3)
    expect(aim.z).toBeCloseTo(-800, 2)
  })
})
