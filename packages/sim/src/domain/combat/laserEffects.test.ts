import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { GROW_RAY, HOLD_RAY, MINING_LASER, PULSE_LASER, SHRINK_RAY } from '../../config/modules'
import { PHYSICS } from '../../config/physics'
import { RAYS } from '../../config/weapons'
import { ASTEROID } from '../../config/world'
import type { LaserModule } from '../loadout'
import { createWorld, STARTER_SYSTEM, type World } from '../world'
import type { AsteroidEntity } from '../world/entities'
import { refreshSpec } from '../world/factory'
import { coolGuns, fireLasers } from './weapons'
import { resolveLaserHit } from './bolts'
import { castLaser } from './raycast'
import { rayOnAsteroid, rayOnShip } from './laserEffects'

/**
 * Лучи-переделки и школы лазеров. Свойства, а не числа: уменьшающий сжимает, но не мельче
 * предела видимости; увеличивающий — не крупнее ×1000 исходного; удерживающий гасит ход;
 * горный колет камень, военный — сразу в пыль.
 */

function scene(): World {
  return createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -500], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
}

function rock(world: World, radius: number, pos = new Vector3(0, 0, -400)): AsteroidEntity {
  const a: AsteroidEntity = {
    id: world.ids.next(),
    kind: 'asteroid',
    pos,
    vel: new Vector3(),
    quat: new Quaternion(),
    spin: new Vector3(),
    radius,
    hull: ASTEROID.HULL,
    shape: 0,
    alive: true,
  }
  world.asteroids.push(a)
  return a
}

/** Поставить на все лазерные точки игрока один ствол — тест про эффект, а не про сборку. */
function arm(world: World, laser: LaserModule): void {
  const p = world.player
  p.loadout = { ...p.loadout, weapons: p.loadout.weapons.map((w) => (w && w.kind === 'laser' ? laser : w)) }
  refreshSpec(p)
  p.laserHeat.heat = 0
  p.state.pos.set(0, 0, 0)
  p.state.quat.copy(new Quaternion())
}

/** Держать гашетку `seconds` секунд такта: стрельба, остывание, ход времени. */
function hold(world: World, seconds: number): void {
  const dt = PHYSICS.FIXED_DT
  for (let t = 0; t < seconds; t += dt) {
    world.player.laserHeat.heat = 0 // тест про эффект луча, а не про перегрев
    fireLasers(world, world.player, false, dt)
    coolGuns(world.player, world.time, dt)
    world.time += dt
  }
}

describe('лучи-переделки', () => {
  it('уменьшающий луч сжимает корабль в прицеле, но не мельче предела видимости', () => {
    const world = scene()
    const enemy = world.ships[0]!
    enemy.state.pos.set(0, 0, -500)
    enemy.state.vel.set(0, 0, 0)
    arm(world, SHRINK_RAY)
    hold(world, 1)
    expect(enemy.state.scale).toBeLessThan(1)

    rayOnShip(enemy, 'shrink', 10, 100)
    expect(enemy.state.scale).toBe(RAYS.MIN_SCALE)
  })

  it('увеличивающий — не крупнее ×1000 исходного, у камня считая от его радиуса', () => {
    const world = scene()
    const enemy = world.ships[0]!
    rayOnShip(enemy, 'grow', 10, 100)
    expect(enemy.state.scale).toBe(RAYS.MAX_SCALE)

    const a = rock(world, 20)
    rayOnAsteroid(a, 'grow', 10, 100)
    expect(a.radius).toBeCloseTo(20 * RAYS.MAX_SCALE)
    // Сжали и раздули снова — предел всё тот же, от ИСХОДНОГО радиуса, а не от текущего.
    rayOnAsteroid(a, 'shrink', 10, 100)
    rayOnAsteroid(a, 'grow', 10, 100)
    expect(a.radius).toBeCloseTo(20 * RAYS.MAX_SCALE)
  })

  it('удерживающий гасит ход и вращение цели', () => {
    const world = scene()
    const enemy = world.ships[0]!
    enemy.state.vel.set(200, 0, 0)
    enemy.state.angVel.set(1, 0, 0)
    rayOnShip(enemy, 'hold', HOLD_RAY.effectRate!, 2)
    expect(enemy.state.vel.length()).toBeLessThan(1)
    expect(enemy.state.angVel.length()).toBeLessThan(0.01)
  })

  it('бога луч не переделывает', () => {
    const world = scene()
    const enemy = world.ships[0]!
    enemy.divine = true
    rayOnShip(enemy, 'shrink', GROW_RAY.effectRate!, 5)
    expect(enemy.state.scale).toBe(1)
  })
})

describe('горный и военный лазер по камню', () => {
  const strikeRock = (laser: LaserModule) => {
    const world = scene()
    world.ships.length = 0
    const a = rock(world, 60)
    const dir = new Vector3(0, 0, -1)
    const hit = castLaser(world, new Vector3(), dir, { id: world.player.id, cloaked: false }, 4000)
    expect(hit.asteroid).toBe(a)
    resolveLaserHit(world, new Vector3(0, 0, -340), hit, laser.damage, false, world.player.id, {
      effect: laser.effect ?? 'blast',
      rate: 0,
      seconds: 0,
    })
    return { pieces: world.asteroids.filter((x) => x.alive && x !== a).length, pods: world.pods.length }
  }

  it('горный колет на осколки', () => {
    expect(strikeRock(MINING_LASER).pieces).toBeGreaterThanOrEqual(ASTEROID.SPLIT_MIN)
  })

  // Лазеры по умолчанию военные: обычный импульсник рассыпает камень, колет только горный.
  it('обычный (военный по умолчанию) — сразу в пыль и руду, без осколков', () => {
    const r = strikeRock(PULSE_LASER)
    expect(r.pieces).toBe(0)
    expect(r.pods).toBeGreaterThan(0)
  })
})
