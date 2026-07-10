import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ASTEROID } from '../../config/world'
import { addCommodity, freeCapacity } from '../cargo/hold'
import { COMMODITIES } from '../cargo/items'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import type { AsteroidEntity } from '../world/entities'
import { damageAsteroid, oreUnits, scoopAsteroid, shatter, splittable } from './mining'

/** Мир без пояса и без патрулей: камни в тестах кладутся руками, поимённо. */
function empty(): World {
  return createWorld({ ...STARTER_SYSTEM, patrols: [], belt: null })
}

function rock(world: World, radius: number, pos = new Vector3(), vel = new Vector3()): AsteroidEntity {
  const a: AsteroidEntity = {
    id: world.ids.next(),
    kind: 'asteroid',
    pos,
    vel,
    quat: world.player.state.quat.clone(),
    spin: new Vector3(),
    radius,
    hull: ASTEROID.HULL,
    shape: 0,
    alive: true,
  }
  world.asteroids.push(a)
  return a
}

describe('дробление сохраняет вещество', () => {
  /**
   * Руда пропорциональна ОБЪЁМУ: вдвое больший камень несёт её в восемь раз
   * больше, а не вдвое. Это и есть закон, из которого следует сохранение при
   * дроблении; проверка суммы осколков ниже без него проходит на любом законе,
   * потому что осколки делят по нему же.
   */
  it('руда растёт как куб радиуса', () => {
    expect(oreUnits(32) / oreUnits(16)).toBeGreaterThan(7.2)
    expect(oreUnits(32) / oreUnits(16)).toBeLessThan(8.8)
  })

  /**
   * Руда считается по КУБУ радиуса, поэтому осколки, делящие объём поровну,
   * несут ровно ту же руду, что и целый камень. Считай руду линейно по радиусу —
   * и каждый выстрел рождал бы вещество из ничего: три куска по 0.7 радиуса
   * дали бы вдвое больше руды, чем исходный камень.
   *
   * Допуск в одну единицу на осколок — это округление до целого груза, не более.
   */
  it('сумма руды осколков равна руде исходного камня', () => {
    const world = empty()
    const parent = rock(world, ASTEROID.RADIUS_MAX)
    const before = oreUnits(parent.radius)

    shatter(world, parent)
    const pieces = world.asteroids.filter((a) => a.alive)
    expect(pieces.length).toBeGreaterThanOrEqual(ASTEROID.SPLIT_MIN)

    const after = pieces.reduce((sum, a) => sum + oreUnits(a.radius), 0)
    expect(Math.abs(after - before)).toBeLessThanOrEqual(pieces.length)
  })

  /**
   * Центр масс не движется, импульс сохраняется. Куски равны по массе, значит
   * достаточно, чтобы сумма их смещений и приращений скорости была нулевой.
   *
   * Без этого пояс получал бы случайный толчок с каждого выстрела и за час
   * уезжал бы из системы. Проверяем свойство, а не конкретные направления:
   * они зависят от зерна.
   */
  it('осколки не сдвигают центр масс и не уносят импульс', () => {
    const world = empty()
    const pos = new Vector3(100, -40, 7)
    const vel = new Vector3(3, 0, -12)
    const parent = rock(world, 30, pos.clone(), vel.clone())

    shatter(world, parent)
    const pieces = world.asteroids.filter((a) => a.alive)

    const centre = new Vector3()
    const momentum = new Vector3()
    for (const p of pieces) {
      centre.add(p.pos)
      momentum.add(p.vel)
    }
    centre.divideScalar(pieces.length)
    momentum.divideScalar(pieces.length)

    expect(centre.distanceTo(pos)).toBeLessThan(1e-6)
    expect(momentum.distanceTo(vel)).toBeLessThan(1e-6)
  })

  /** Мельчайший камень делить не на что: он и есть одна единица груза. */
  it('неделимый камень становится ровно одним контейнером руды', () => {
    const world = empty()
    const pebble = rock(world, ASTEROID.MIN_SPLIT_RADIUS)
    expect(splittable(pebble)).toBe(false)

    shatter(world, pebble)

    expect(world.asteroids.filter((a) => a.alive)).toHaveLength(0)
    expect(world.pods).toHaveLength(1)
    const [pod] = world.pods
    expect(pod?.item.kind).toBe('commodity')
    if (pod?.item.kind === 'commodity') {
      expect(pod.item.commodity.id).toBe(COMMODITIES.MINERALS.id)
      expect(pod.item.units).toBe(oreUnits(pebble.radius))
    }
  })

  /** Камень не исчезает от урона — он раскалывается. Второй способ убить его сломал бы руду. */
  it('лазер, добивший камень, оставляет осколки, а не пустоту', () => {
    const world = empty()
    const parent = rock(world, 24)

    damageAsteroid(world, parent, ASTEROID.HULL / 2)
    expect(parent.alive).toBe(true)
    expect(world.asteroids.filter((a) => a.alive)).toHaveLength(1)

    damageAsteroid(world, parent, ASTEROID.HULL / 2)
    expect(parent.alive).toBe(false)
    expect(world.asteroids.filter((a) => a.alive).length).toBeGreaterThanOrEqual(ASTEROID.SPLIT_MIN)
  })
})

describe('зачерпывание камня', () => {
  it('мелкий камень уходит в трюм целиком', () => {
    const world = empty()
    const player = world.player
    player.hold.items = []
    const pebble = rock(world, ASTEROID.SCOOP_MAX_RADIUS)

    const free = freeCapacity(player.hold)
    expect(free).toBeGreaterThanOrEqual(oreUnits(pebble.radius))

    expect(scoopAsteroid(player, pebble)).toBe(true)
    expect(pebble.alive).toBe(false)
    expect(freeCapacity(player.hold)).toBe(free - oreUnits(pebble.radius))
  })

  /** Решает масса, а не желание пилота: крупный камень в люк не лезет. */
  it('крупный камень не зачерпывается, а значит будет удар', () => {
    const world = empty()
    const boulder = rock(world, ASTEROID.SCOOP_MAX_RADIUS + 0.5)
    expect(scoopAsteroid(world.player, boulder)).toBe(false)
    expect(boulder.alive).toBe(true)
  })

  /**
   * Полный трюм не отменяет физику: камень остаётся в мире и ударит корабль.
   * Раньше отказ трюма молча съедал камень — руда пропадала, а удара не было.
   */
  it('в полный трюм камень не влезает и остаётся камнем', () => {
    const world = empty()
    const player = world.player
    addCommodity(player.hold, COMMODITIES.MINERALS, player.hold.capacity)
    expect(freeCapacity(player.hold)).toBe(0)

    const pebble = rock(world, ASTEROID.RADIUS_MIN)
    expect(scoopAsteroid(player, pebble)).toBe(false)
    expect(pebble.alive).toBe(true)
  })
})
