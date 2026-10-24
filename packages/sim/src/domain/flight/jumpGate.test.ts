import { describe, expect, it } from 'vitest'
import { veteranWorld } from '../../testkit'
import { Vector3 } from 'three'
import { type JumpGate } from '../world'
import { LINKED_PORTAL } from '../../config/galaxy'
import {
  crossedJumpGate,
  fitsInsideJumpGate,
  jumpGateRel,
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
    const ship = veteranWorld().player
    expect(linkedPortalAhead(ship)).toBeGreaterThanOrEqual(100)

    ship.state.scale = 20
    expect(linkedPortalAhead(ship)).toBeCloseTo(ship.spec.hull.radius * 20 * 10)
  })

  it('за 2.5 с раскрывает чистый проход до заданного числа диаметров корпуса', () => {
    const ship = veteranWorld().player
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
    const target = linkedPortalTargetRadius(veteranWorld().player)
    const radius = target * LINKED_PORTAL.CLOSE_FRACTION * 1.1
    const dt = LINKED_PORTAL.OPEN_SECONDS * LINKED_PORTAL.CLOSE_FRACTION * 0.2

    expect(stepLinkedPortalRadius(radius, target, -1, true, dt)).toBe(0)
  })

  it('отбрасывает от трубы без урона', () => {
    const world = veteranWorld()
    const ship = world.player
    const hull = ship.hull
    ship.state.pos.set(57, 0, 0)
    ship.state.vel.set(-100, 0, 0)

    stepJumpGateCollision(ship, gate())

    expect(ship.state.vel.x).toBeGreaterThan(0)
    expect(ship.hull).toBe(hull)
  })

  it('не трогает корабль в центре широкого отверстия', () => {
    const world = veteranWorld()
    const ship = world.player
    ship.state.pos.set(0, 0, 1)
    ship.state.vel.set(0, 0, -100)

    stepJumpGateCollision(ship, gate())

    expect(ship.state.pos.z).toBe(1)
    expect(ship.state.vel.z).toBe(-100)
  })

  it('считает проход через отверстие в обе стороны', () => {
    const ship = veteranWorld().player
    const mouth = gate()

    ship.state.pos.set(0, 0, -1)
    const behind = jumpGateRel(ship, mouth, new Vector3())
    ship.state.pos.set(0, 0, 1)
    expect(fitsInsideJumpGate(ship, mouth)).toBe(true)
    expect(crossedJumpGate(behind, ship, mouth)).toBe(true)
    const ahead = jumpGateRel(ship, mouth, new Vector3())
    ship.state.pos.set(0, 0, -1)
    expect(crossedJumpGate(ahead, ship, mouth)).toBe(true)
  })

  it('на форсаже засчитывает проход по точке пересечения, а не по конечной точке кадра', () => {
    // Пойманное: за кадр на форсаже корабль уходил на километры за кольцо; при наклоне курса
    // в пару градусов конечная точка оказывалась сбоку от оси — «мимо отверстия», перехода нет.
    const ship = veteranWorld().player
    const mouth = gate()
    ship.state.pos.set(0, 0, -100)
    const before = jumpGateRel(ship, mouth, new Vector3())
    // 2.7 км за кадр с уклоном ~3°: через плоскость — у самой оси, в конце — в 140 м сбоку.
    ship.state.pos.set(140, 0, 2_600)
    expect(fitsInsideJumpGate(ship, mouth)).toBe(false)
    expect(crossedJumpGate(before, ship, mouth)).toBe(true)
  })

  it('пролёт мимо кольца — не переход, даже если в конце кадра корабль на оси', () => {
    const ship = veteranWorld().player
    const mouth = gate()
    ship.state.pos.set(500, 0, -100)
    const before = jumpGateRel(ship, mouth, new Vector3())
    ship.state.pos.set(0, 0, 100)
    expect(crossedJumpGate(before, ship, mouth)).toBe(false)
  })

  it('не пропускает корпус, который центром попал в отверстие, но цепляет трубу', () => {
    const ship = veteranWorld().player
    ship.state.pos.set(40, 0, 0)

    expect(fitsInsideJumpGate(ship, gate())).toBe(false)
  })
})
