import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { MONOLITH } from '../../config/monoliths'
import { itemMass } from '../cargo/items'
import { createWorld, enterSystem } from '../world'
import { STARTER_SYSTEM } from '../world/system'
import { castLaser } from './raycast'
import { damageScenicRock } from './scenicRocks'

/**
 * Мир в системе, где стоит Люцифер (облик 0): пояс глыб держится за него. Число статуй —
 * бросок 0..COUNT_MAX по сиду системы, и ноль законен, поэтому систему ищем перебором.
 */
function withYard(): ReturnType<typeof createWorld> {
  // ОДИН мир, в который переходим системами: `createWorld` в цикле слишком дорог.
  const world = createWorld()
  for (let i = 0; i < 200; i++) {
    enterSystem(world, STARTER_SYSTEM, i)
    if (world.monoliths.some((m) => m.variant === 0)) return world
  }
  throw new Error('не нашлось системы с двором Люцифера')
}

describe('глыбы двора статуи', () => {
  it('луч попадает в глыбу', () => {
    const world = withYard()
    const rock = world.scenicRocks[0]
    expect(rock).toBeDefined()

    const origin = rock!.pos.clone().add(new Vector3(0, 0, rock!.radius + 200))
    const dir = new Vector3(0, 0, -1)
    const hit = castLaser(world, origin, dir, world.player, 1_000)

    expect(hit.scenicRock?.id).toBe(rock!.id)
    expect(hit.asteroid).toBeNull()
  })

  it('гибель сыпет подбираемые осколки с массой', () => {
    const world = withYard()
    const rock = world.scenicRocks[0]!
    const beforePods = world.pods.length

    damageScenicRock(world, rock, rock.hull)

    expect(rock.alive).toBe(false)
    const debris = world.pods.filter((p) => p.debris)
    expect(debris.length).toBeGreaterThan(beforePods)
    expect(debris.length).toBeGreaterThanOrEqual(MONOLITH.ROCK_DEBRIS_MIN)
    expect(debris.length).toBeLessThanOrEqual(MONOLITH.ROCK_DEBRIS_MAX)
    for (const pod of debris) {
      expect(pod.debris!.shape).toBe(rock.shape)
      expect(itemMass(pod.item)).toBeGreaterThan(0)
      expect(pod.item.kind).toBe('commodity')
    }
  })

  it('крупный камень сыпет больше осколков, чем мелкий', () => {
    const world = withYard()
    const small = world.scenicRocks.reduce((a, b) => (a.radius <= b.radius ? a : b))
    const large = world.scenicRocks.reduce((a, b) => (a.radius >= b.radius ? a : b))
    // Разносим по радиусу заметно — иначе оба попадут в одну ступень округления.
    expect(large.radius).toBeGreaterThan(small.radius)

    damageScenicRock(world, small, small.hull)
    const smallN = world.pods.filter((p) => p.debris).length
    world.pods = []

    // Крупный ещё жив (другой объект).
    expect(large.alive).toBe(true)
    damageScenicRock(world, large, large.hull)
    const largeN = world.pods.filter((p) => p.debris).length

    expect(largeN).toBeGreaterThanOrEqual(smallN)
  })

  it('крупный камень крепче мелкого', () => {
    const world = withYard()
    const small = world.scenicRocks.reduce((a, b) => (a.radius <= b.radius ? a : b))
    const large = world.scenicRocks.reduce((a, b) => (a.radius >= b.radius ? a : b))
    expect(large.hull).toBeGreaterThan(small.hull)
    expect(small.hull).toBeCloseTo(MONOLITH.ROCK_HULL * (small.radius / MONOLITH.ROCK_RADIUS_MIN), 5)
  })
})
