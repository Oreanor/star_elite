import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { PHYSICS } from '../../config/physics'
import { createWorld, despawnRemotePlayer, spawnRemotePlayer, STARTER_SYSTEM, type World } from '../world'
import { stepWorld } from './step'

/**
 * Кинематический борт. Его состояние ставится ИЗВНЕ (на клиенте — интерполятор по
 * снапшотам чужого игрока), поэтому шаг мира его НЕ двигает: контроллер, физика и
 * столкновения пропускают такой борт. Это позволяет держать удалённого игрока обычным
 * `ShipEntity` в `world.ships` (единый бой, без ветки «а это сетевой»), не давая
 * симуляции спорить с сетью за его положение.
 */

const NO_CONTROLLERS = new Map()
const oneStep = (world: World) => stepWorld(world, PHYSICS.FIXED_DT, NO_CONTROLLERS)

/** Тихий мир без патрулей и пояса: лишние борта и камни тесту ни к чему. */
function quiet(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

/** Истинная позиция игрока: pos + originOffset. Инвариант к сдвигу начала координат. */
function truePos(world: World) {
  return world.player.state.pos.clone().add(world.originOffset)
}

describe('кинематический борт', () => {
  it('не движется шагом мира — позу задаёт внешний источник', () => {
    const world = quiet()
    world.player.kinematic = true
    // Будь борт обычным — на 200 м/с он бы улетел; интегратор его пропустит.
    world.player.state.vel.set(200, 0, 0)
    const before = truePos(world)

    oneStep(world)

    expect(truePos(world).distanceTo(before)).toBeLessThan(1e-3)
  })

  it('без флага тот же борт со скоростью движется (контроль)', () => {
    const world = quiet()
    world.player.state.vel.set(200, 0, 0)
    const before = truePos(world)

    oneStep(world)

    // Обычный борт интегрируется: за шаг физики сдвинулся ощутимо.
    expect(truePos(world).distanceTo(before)).toBeGreaterThan(0.1)
  })
})

describe('удалённый игрок как кинематический борт', () => {
  const at = (world: World, id: number) => {
    const s = world.ships.find((x) => x.id === id)
    if (!s) throw new Error('борт пропал из мира')
    return s
  }

  it('спавнится в world.ships: кинематический, нейтральный, со своим видом/лицом/именем', () => {
    const world = quiet()
    const before = world.ships.length

    const ship = spawnRemotePlayer(world, {
      name: 'Ррау', species: 'Фелиды', portrait: 12, pos: new Vector3(0, 0, 0), quat: new Quaternion(),
    })

    expect(world.ships.length).toBe(before + 1)
    expect(ship.kinematic).toBe(true)
    // Чужой человек — не враг и не полиция; `player` зарезервирована за локальным.
    expect(ship.faction).toBe('neutral')
    expect(ship.persona.species).toBe('Фелиды')
    expect(ship.persona.portrait).toBe(12)
    expect(ship.pilotName).toBe('Ррау')
  })

  it('шаг мира его не двигает — позу ведёт интерполятор', () => {
    const world = quiet()
    const ship = spawnRemotePlayer(world, {
      name: 'X', species: 'Земляне', portrait: 0, pos: new Vector3(0, 0, 0), quat: new Quaternion(),
    })
    // Скорость выставлена, но интегратор кинематический борт пропустит.
    ship.state.vel.set(300, 0, 0)
    const before = ship.state.pos.clone().add(world.originOffset)

    oneStep(world)

    const after = at(world, ship.id).state.pos.clone().add(world.originOffset)
    expect(after.distanceTo(before)).toBeLessThan(1e-3)
  })

  it('despawn убирает его из мира', () => {
    const world = quiet()
    const ship = spawnRemotePlayer(world, {
      name: 'X', species: 'Земляне', portrait: 0, pos: new Vector3(), quat: new Quaternion(),
    })

    despawnRemotePlayer(world, ship.id)

    expect(world.ships.some((s) => s.id === ship.id)).toBe(false)
  })
})
