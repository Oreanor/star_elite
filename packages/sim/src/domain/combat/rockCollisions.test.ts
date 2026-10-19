import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { ASTEROID, COMET, TRAFFIC } from '../../config/world'
import { SHIELD } from '../../config/station'
import { createWorld, STARTER_SYSTEM } from '../world'
import type { AsteroidEntity, World } from '../world/entities'
import { despawnDistantAsteroids } from '../world/asteroidEncounter'
import { spawnComet } from '../world/comets'
import { asteroidMass, shatter } from './mining'
import { stepRockCollisions } from './rockCollisions'

/**
 * Камни и кометы — физические объекты: сталкиваются с телами, полем станции и друг с другом,
 * а обломки кометы теряют её скорость. Проверяем свойства, а не числа.
 */

function quietWorld(): World {
  const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
  world.asteroids.length = 0
  return world
}

function rock(world: World, pos: Vector3, vel: Vector3, radius = 30, comet = false): AsteroidEntity {
  const a: AsteroidEntity = {
    id: world.ids.next(),
    kind: 'asteroid',
    pos: pos.clone(),
    vel: vel.clone(),
    quat: new Quaternion(),
    spin: new Vector3(),
    radius,
    hull: ASTEROID.HULL,
    shape: 0,
    alive: true,
    ...(comet ? { comet: true as const } : {}),
  }
  world.asteroids.push(a)
  return a
}

describe('кометы', () => {
  /** Пролёт в виду, а не в лоб: ближайшее сближение прямой — в пределах заданного промаха. */
  it('рождается у кромки и летит мимо игрока на заданном промахе', () => {
    const world = quietWorld()
    const c = spawnComet(world)!
    expect(c.comet).toBe(true)
    const p = world.player.state.pos
    expect(c.pos.distanceTo(p)).toBeCloseTo(COMET.SPAWN_DISTANCE, 0)
    const dir = c.vel.clone().normalize()
    const toPlayer = p.clone().sub(c.pos)
    const along = toPlayer.dot(dir)
    const miss = toPlayer.addScaledVector(dir, -along).length()
    expect(along).toBeGreaterThan(0) // летит к игроку, а не прочь
    expect(miss).toBeGreaterThan(COMET.MISS_MIN * 0.9)
    expect(miss).toBeLessThan(COMET.MISS_MAX * 1.1)
  })

  /**
   * Хвост длиннее пузыря трафика. Уборка по 20 км срезала ядро, пока лента ещё
   * закрывала объектив. Камень на той же дистанции уходит, комета — нет.
   */
  it('комета переживает горизонт радара и уходит только за своим пределом', () => {
    const world = quietWorld()
    const p = world.player.state.pos
    const comet = rock(world, new Vector3(TRAFFIC.DESPAWN_RANGE * 2, 0, 0).add(p), new Vector3(), 80, true)
    const stone = rock(world, new Vector3(TRAFFIC.DESPAWN_RANGE + 500, 0, 0).add(p), new Vector3())
    const gone = rock(world, new Vector3(COMET.DESPAWN_RANGE + 500, 0, 0).add(p), new Vector3(), 80, true)
    despawnDistantAsteroids(world)
    const ids = world.asteroids.map((a) => a.id)
    expect(ids).toContain(comet.id)
    expect(ids).not.toContain(stone.id)
    expect(ids).not.toContain(gone.id)
  })

  it('не больше заданного числа комет разом', () => {
    const world = quietWorld()
    for (let i = 0; i < COMET.MAX_LIVE + 3; i++) spawnComet(world)
    expect(world.asteroids.filter((a) => a.alive && a.comet).length).toBe(COMET.MAX_LIVE)
  })

  /** Раскол кометы: куски несут малую долю её скорости — облако почти встаёт, а не уносится. */
  it('обломки кометы теряют скорость', () => {
    const world = quietWorld()
    const speed = 1000
    const c = rock(world, new Vector3(0, 0, -5000), new Vector3(speed, 0, 0), 100, true)
    shatter(world, c)
    const pieces = world.asteroids.filter((a) => a.alive && a !== c)
    expect(pieces.length).toBeGreaterThan(0)
    for (const p of pieces) expect(p.vel.length()).toBeLessThan(speed * 0.5)
    expect(pieces.some((p) => p.comet)).toBe(false) // куски — не кометы
  })
})

describe('столкновения камней', () => {
  it('удар о планету уничтожает камень', () => {
    const world = quietWorld()
    const planet = world.bodies.find((b) => b.kind === 'planet')!
    const a = rock(world, planet.pos.clone().add(new Vector3(planet.radius + 10, 0, 0)), new Vector3())
    stepRockCollisions(world)
    expect(a.alive).toBe(false)
  })

  it('поле станции отражает летящий внутрь камень, но не разбивает', () => {
    const world = quietWorld()
    const station = world.bodies.find((b) => b.kind === 'station')!
    const r = station.radius * SHIELD.RADIUS_FACTOR
    const a = rock(world, station.pos.clone().add(new Vector3(r + 5, 0, 0)), new Vector3(-50, 0, 0), 20)
    stepRockCollisions(world)
    expect(a.alive).toBe(true)
    expect(a.vel.x).toBeGreaterThan(0) // развернулся наружу
  })

  it('быстрые камни раскалывают друг друга', () => {
    const world = quietWorld()
    const v = ASTEROID.IMPACT_SPEED
    const a = rock(world, new Vector3(0, 0, -9000), new Vector3(v, 0, 0), 40)
    const b = rock(world, new Vector3(70, 0, -9000), new Vector3(-v, 0, 0), 40)
    stepRockCollisions(world)
    expect(a.alive).toBe(false)
    expect(b.alive).toBe(false)
  })

  /** Медленное касание — отскок, и импульс пары сохраняется (тяжёлый почти не сдвигается). */
  it('медленные отскакивают, импульс сохраняется', () => {
    const world = quietWorld()
    const a = rock(world, new Vector3(0, 0, -9000), new Vector3(5, 0, 0), 60)
    const b = rock(world, new Vector3(75, 0, -9000), new Vector3(-5, 0, 0), 20)
    const ma = asteroidMass(a.radius)
    const mb = asteroidMass(b.radius)
    const before = a.vel.x * ma + b.vel.x * mb
    stepRockCollisions(world)
    expect(a.alive && b.alive).toBe(true)
    expect(a.vel.x * ma + b.vel.x * mb).toBeCloseTo(before, 6)
    expect(b.vel.x).toBeGreaterThan(0) // лёгкий отлетел
  })

  it('вплотную, но расходятся — не трогаем', () => {
    const world = quietWorld()
    const a = rock(world, new Vector3(0, 0, -9000), new Vector3(-5, 0, 0), 40)
    const b = rock(world, new Vector3(70, 0, -9000), new Vector3(5, 0, 0), 40)
    stepRockCollisions(world)
    expect(a.vel.x).toBe(-5)
    expect(b.vel.x).toBe(5)
  })
})
