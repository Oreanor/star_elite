import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { HYPERDRIVE } from '../../config/heat'
import { chargeHyperdrive, scooping, stepStarHeat } from '../combat'
import { dock } from '../station/docking'
import { createWorld, type World } from '../world'
import { jump, jumpBlock, jumpDistance } from './jump'

/**
 * Гипертопливо.
 *
 * Дальность прыжка — не постоянная привода, а его ЗАРЯД: сфера сжимается на
 * пройденный путь и восполняется только у звезды (прогревшись, но не сгорая) или
 * у причала. Проверяем сам цикл, а не числа: прыжок тратит, звезда доливает,
 * пустой бак закрывает дальние прыжки не тем же поводом, что слабый привод.
 */

const DT = 1 / 120

/** Ставит игрока на высоту `ratio` радиусов над поверхностью звезды. */
function place(world: World, ratio: number): void {
  const star = world.bodies.find((b) => b.kind === 'star')!
  world.player.state.pos.copy(star.pos).add(new Vector3(star.radius * (1 + ratio), 0, 0))
}

function heat(world: World, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    world.time += DT
    stepStarHeat(world.player, world, DT)
    chargeHyperdrive(world.player, DT)
  }
}

/** Индекс системы, до которой заведомо можно дотянуться полным баком. */
function reachableTarget(world: World): number {
  const range = world.player.spec.jumpRange
  for (let i = 0; i < 2500; i++) {
    if (i === world.systemIndex) continue
    const d = jumpDistance(world, i)
    if (d > 1 && d < range) return i
  }
  throw new Error('нет доступной цели для прыжка')
}

describe('гипертопливо', () => {
  it('свежий корабль заряжен под завязку', () => {
    const world = createWorld()
    expect(world.player.jumpCharge).toBe(world.player.spec.jumpRange)
  })

  it('прыжок тратит заряд ровно на пройденную дальность', () => {
    const world = createWorld()
    const target = reachableTarget(world)
    const distance = jumpDistance(world, target)
    const before = world.player.jumpCharge

    expect(jump(world, target)).toBe(true)
    expect(world.player.jumpCharge).toBeCloseTo(before - distance, 3)
  })

  it('опустошив бак, дальний прыжок закрыт зарядом, а не приводом', () => {
    const world = createWorld()
    const target = reachableTarget(world)
    // Есть привод и цель в пределах модели, но заряд на нуле.
    world.player.jumpCharge = 0
    expect(jumpBlock(world, target)).toBe('out-of-charge')
    // Слабый повод — иной: он про модель, а не про топливо.
    expect(jumpBlock(world, target)).not.toBe('out-of-range')
  })

  it('у звезды бак доливается — но лишь прогревшись до полки', () => {
    const world = createWorld()
    world.player.jumpCharge = 0

    // Далеко — холодно, не черпается.
    place(world, 3)
    heat(world, 5)
    expect(world.player.jumpCharge).toBe(0)
    expect(scooping(world.player)).toBe(false)

    // На полке (0.35 радиуса) — греется выше порога зарядки, но ниже порога течи.
    place(world, 0.35)
    heat(world, 20)
    expect(world.player.jumpCharge).toBeGreaterThan(world.player.spec.jumpRange - 0.5)
    // И всё это время корпус цел: полка ниже температуры, при которой течёт.
    expect(world.player.hull).toBe(world.player.spec.hull.hull)
  })

  it('заряд не переливается выше предела модели', () => {
    const world = createWorld()
    place(world, 0.2)
    heat(world, 40) // держим долго
    expect(world.player.jumpCharge).toBeLessThanOrEqual(world.player.spec.jumpRange)
  })

  it('стыковка заправляет бак под завязку', () => {
    const world = createWorld()
    world.player.jumpCharge = 3
    // Игрок стартует у причала — подводим к нему тихо и медленно.
    const station = world.bodies.find((b) => b.kind === 'station')!
    world.player.state.pos.copy(station.pos)
    world.player.state.vel.set(0, 0, 0)
    world.dockArmed = true

    expect(dock(world)).toBe(true)
    expect(world.player.jumpCharge).toBe(world.player.spec.jumpRange)
  })
})
