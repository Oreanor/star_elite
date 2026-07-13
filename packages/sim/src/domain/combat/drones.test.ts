import { describe, expect, it } from 'vitest'
import { DRONE_BAY } from '../../config/modules'
import { selectTarget } from '../ai/targeting'
import { createAIState } from '../ai'
import { Vector3 } from 'three'
import { stepWorld } from '../sim'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import type { ShipEntity } from '../world/entities'
import { activeDrones, expireDrones, isDroneShip, launchDrone } from './drones'
import { armMissiles } from '../station/shop'

/**
 * Беспилотники. Их ценность — не урон, а то, что враг тратит на них внимание.
 * Значит и проверять надо не урон, а бухгалтерию: потолок, срок, отсутствие
 * трофеев и то, что пират их ВИДИТ.
 */

function withPirate(): { world: World; pirate: ShipEntity } {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -300], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  const pirate = world.ships[0]
  if (!pirate) throw new Error('нет пирата')
  // Дрон-ракеты — покупной тип мунишн-слота: на старте их нет, снаряжаем явно.
  world.credits = 1_000_000
  armMissiles(world, world.player, DRONE_BAY)
  world.player.state.pos.set(0, 0, 0)
  pirate.state.pos.set(0, 0, -300)
  pirate.ai = createAIState(new Vector3(0, 0, -300), world.rng)
  return { world, pirate }
}

/** Пусковая перезаряжается: без сброса перезарядки за раз уходит один аппарат. */
function launchNow(world: World, owner: ShipEntity): ShipEntity | null {
  for (const gun of owner.guns) gun.cooldown = 0
  return launchDrone(world, owner)
}

describe('выпуск беспилотников', () => {
  it('аппарат сходит со скоростью носителя и в стороне от него', () => {
    const { world } = withPirate()
    const player = world.player
    player.state.vel.set(0, 0, -120)

    const drone = launchNow(world, player)
    expect(drone).not.toBeNull()
    if (!drone) return

    expect(isDroneShip(drone)).toBe(true)
    expect(drone.droneOf).toBe(player.id)
    expect(drone.faction).toBe(player.faction)
    // Рождённый неподвижным аппарат всю жизнь догонял бы бой.
    expect(drone.state.vel.z).toBeCloseTo(-120)
    // И рождённый в центре носителя вытолкнул бы его столкновением.
    expect(drone.state.pos.distanceTo(player.state.pos)).toBeGreaterThan(player.spec.hull.radius)
  })

  /**
   * Потолок одновременных совпадает с боезапасом контейнера не случайно:
   * контейнер один, и выпустить лишнего просто нечем. Но проверяем именно
   * потолок — он и есть правило, а боезапас лишь его следствие.
   */
  it('больше потолка одновременно не летает', () => {
    const { world } = withPirate()
    const player = world.player

    for (let i = 0; i < DRONE_BAY.maxActive; i++) expect(launchNow(world, player)).not.toBeNull()
    expect(activeDrones(world, player)).toBe(DRONE_BAY.maxActive)

    expect(launchNow(world, player)).toBeNull()
    expect(activeDrones(world, player)).toBe(DRONE_BAY.maxActive)
  })

  /** Срок задан в СЕКУНДАХ и от частоты шага не зависит: истекает по `world.time`. */
  it('самоликвидируется по истечении срока', () => {
    const { world } = withPirate()
    const drone = launchNow(world, world.player)
    if (!drone) throw new Error('аппарат не вышел')

    expect(drone.dieAt).toBeCloseTo(world.time + DRONE_BAY.lifetime)

    world.time = drone.dieAt! - 0.01
    expireDrones(world)
    expect(drone.alive).toBe(true)

    world.time = drone.dieAt!
    expireDrones(world)
    expect(drone.alive).toBe(false)
  })

  /**
   * Рой из четырёх аппаратов, оставляющих трофеи, превратился бы в станок для
   * печати денег: каждый несёт двигатель и маневровые.
   */
  it('обломок аппарата не оставляет ни трофеев, ни очков', () => {
    const { world } = withPirate()
    const player = world.player
    const drone = launchNow(world, player)
    if (!drone) throw new Error('аппарат не вышел')

    const podsBefore = world.pods.length
    const scoreBefore = world.score
    const creditsBefore = world.credits

    drone.alive = false
    stepFrame(world)

    expect(world.pods.length).toBe(podsBefore)
    expect(world.score).toBe(scoreBefore)
    expect(world.credits).toBe(creditsBefore)
  })
})

describe('беспилотник оттягивает внимание', () => {
  /**
   * Никакого «флага агрессии» нет: пират выбирает БЛИЖАЙШУЮ враждебную цель тем
   * же `selectTarget`, что и всегда. Аппарат, оказавшийся ближе игрока, забирает
   * его прицел просто по геометрии — и в этом весь смысл механики.
   */
  it('пират переключается на аппарат, оказавшийся ближе игрока', () => {
    const { world, pirate } = withPirate()
    expect(selectTarget(pirate, world)).toBe(world.player)

    const drone = launchNow(world, world.player)
    if (!drone) throw new Error('аппарат не вышел')
    drone.state.pos.set(0, 0, -280) // ближе к пирату, чем игрок

    expect(selectTarget(pirate, world)).toBe(drone)
  })
})

/** Один кадр мира без контроллеров: нужна только уборка. */
function stepFrame(world: World): void {
  stepWorld(world, 1 / 60, new Map())
}
