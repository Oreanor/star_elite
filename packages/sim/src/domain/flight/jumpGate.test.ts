import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createWorld, type JumpGate } from '../world'
import { LINKED_PORTAL } from '../../config/galaxy'
import {
  crossedJumpGate,
  fitsInsideJumpGate,
  jumpGateSide,
  linkedPortalAhead,
  linkedPortalTargetRadius,
  stepJumpGateCollision,
  stepLinkedPortalRadius,
} from './jumpGate'

const gate = (): JumpGate => ({
  pos: new Vector3(),
  normal: new Vector3(0, 0, 1),
  radius: 45,
  tube: 2.4,
})

describe('твёрдый обод гиперпортала', () => {
  it('ставит устье не ближе 100 м и отодвигает его для крупного корпуса', () => {
    const ship = createWorld().player
    expect(linkedPortalAhead(ship)).toBeGreaterThanOrEqual(100)

    ship.state.scale = 20
    expect(linkedPortalAhead(ship)).toBeCloseTo(ship.spec.hull.radius * 20 * 10)
  })

  it('за 2.5 с раскрывает чистый проход до заданного числа диаметров корпуса', () => {
    const ship = createWorld().player
    const target = linkedPortalTargetRadius(ship)
    const opened = stepLinkedPortalRadius(0, target, 1, true, LINKED_PORTAL.OPEN_SECONDS)
    const clearDiameter = (opened - LINKED_PORTAL.TUBE) * 2

    expect(opened).toBe(target)
    expect(clearDiameter).toBeCloseTo(
      ship.spec.hull.radius * 2 * LINKED_PORTAL.CLEAR_DIAMETERS,
    )
    // Отпускание H обязано зафиксировать размер: закрытие начинается только новым удержанием.
    expect(stepLinkedPortalRadius(opened, target, -1, false, LINKED_PORTAL.OPEN_SECONDS)).toBe(opened)
    expect(stepLinkedPortalRadius(opened, target, -1, true, LINKED_PORTAL.OPEN_SECONDS)).toBe(0)
  })

  it('защёлкивает почти невидимый остаток кольца в полностью закрытое состояние', () => {
    const target = linkedPortalTargetRadius(createWorld().player)
    const radius = target * LINKED_PORTAL.CLOSE_FRACTION * 1.1
    const dt = LINKED_PORTAL.OPEN_SECONDS * LINKED_PORTAL.CLOSE_FRACTION * 0.2

    expect(stepLinkedPortalRadius(radius, target, -1, true, dt)).toBe(0)
  })

  it('отбрасывает от трубы без урона', () => {
    const world = createWorld()
    const ship = world.player
    const hull = ship.hull
    ship.state.pos.set(57, 0, 0)
    ship.state.vel.set(-100, 0, 0)

    stepJumpGateCollision(ship, gate())

    expect(ship.state.vel.x).toBeGreaterThan(0)
    expect(ship.hull).toBe(hull)
  })

  it('не трогает корабль в центре широкого отверстия', () => {
    const world = createWorld()
    const ship = world.player
    ship.state.pos.set(0, 0, 1)
    ship.state.vel.set(0, 0, -100)

    stepJumpGateCollision(ship, gate())

    expect(ship.state.pos.z).toBe(1)
    expect(ship.state.vel.z).toBe(-100)
  })

  it('считает проход через отверстие в обе стороны', () => {
    const ship = createWorld().player
    const mouth = gate()

    ship.state.pos.set(0, 0, -1)
    const behind = jumpGateSide(ship, mouth)
    ship.state.pos.set(0, 0, 1)
    const ahead = jumpGateSide(ship, mouth)

    expect(fitsInsideJumpGate(ship, mouth)).toBe(true)
    expect(crossedJumpGate(behind, ahead, true)).toBe(true)
    expect(crossedJumpGate(ahead, behind, true)).toBe(true)
  })

  it('не пропускает корпус, который центром попал в отверстие, но цепляет трубу', () => {
    const ship = createWorld().player
    ship.state.pos.set(40, 0, 0)

    expect(fitsInsideJumpGate(ship, gate())).toBe(false)
  })
})
