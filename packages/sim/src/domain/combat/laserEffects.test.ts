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
import { resolveLaserHit, strikeYield } from './bolts'
import { withUpgrade } from '../station/moduleState'
import { castLaser } from './raycast'
import { rayOnAsteroid, rayOnShip, rayOnStatue } from './laserEffects'

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
  it('статую-исполина лучи достают с сотен км — и уменьшают, и увеличивают', () => {
    // Пойманное: дальность была 10 км. Статуя радиусом 50 км — пару раз ужал изнутри её сферы,
    // вышел наружу, и луч больше не доставал; увеличивать с сотен км не удавалось вовсе.
    for (const [ray, grows] of [[SHRINK_RAY, false], [GROW_RAY, true]] as const) {
      const world = scene()
      world.ships = []
      const statue = {
        id: world.ids.next(), kind: 'monolith' as const, variant: 0, pos: new Vector3(0, 60_000, -300_000),
        spinAxis: new Vector3(0, 1, 0), spin: 0, radius: 50_000,
      }
      world.monoliths = [statue]
      arm(world, ray)
      // В стороне от причала, что стоит у начала координат прямо по курсу.
      world.player.state.pos.set(0, 60_000, 0)
      hold(world, 4)
      if (grows) expect(statue.radius).toBeGreaterThan(50_000 * 1.5)
      else expect(statue.radius).toBeLessThan(50_000 / 1.5)
    }
  })

  it('размер течёт плавно: каждый шаг в луче — свой маленький шаг масштаба, без ступеней', () => {
    // Пойманный баг: переделка шла тиками боя (`BEAM_TICK`, 0.25 с) — размер прыгал на 19%
    // четыре раза в секунду, а между тиками стоял. Теперь каждый такт в луче меняет масштаб.
    const world = scene()
    const enemy = world.ships[0]!
    enemy.state.pos.set(0, 0, -500)
    enemy.state.vel.set(0, 0, 0)
    arm(world, GROW_RAY)
    const dt = PHYSICS.FIXED_DT
    let prev = enemy.state.scale
    let maxStep = 0
    for (let i = 0; i < 60; i++) {
      hold(world, dt)
      const k = enemy.state.scale / prev
      expect(k, `шаг ${i}`).toBeGreaterThan(1)
      maxStep = Math.max(maxStep, k)
      prev = enemy.state.scale
    }
    expect(maxStep).toBeLessThan(1.05)
  })

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
      oreYield: laser.oreYield ?? 1,
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

describe('лучи по статуям и военным базам', () => {
  const baseWorld = () =>
    createWorld({
      ...STARTER_SYSTEM,
      patrols: [],
      belt: null,
      warBases: [{ name: 'База', radius: 1_000, stationOffset: [8_000, 0, 0], model: 0 }],
    })

  // Деталь базы держит ПОПАДАНИЯ, а не урон: тики луча-переделки (несколько в секунду) иначе
  // сносили бы турели нулевым уроном. Луч меняет базу целиком и в счёт попаданий не идёт.
  it('луч-переделка по детали базы меняет базу, но турель не сносит', () => {
    const world = baseWorld()
    const base = world.warBases[0]!
    const fix = base.fixtures.find((f) => f.alive)!
    const hitsBefore = fix.hitsLeft
    const sizeBefore = fix.size
    const hit = {
      distance: 0, ship: null, asteroid: null, warBase: null, warBaseFixture: { base, fixture: fix },
      missile: null, platform: null, station: null, statue: null, titan: null,
    }
    for (let i = 0; i < 20; i++) {
      world.time += 1
      resolveLaserHit(world, base.pos.clone(), hit, 0, false, world.player.id, { effect: 'grow', rate: 0.7, seconds: 0.25, oreYield: 1 })
    }
    expect(fix.alive).toBe(true)
    expect(fix.hitsLeft).toBe(hitsBefore)
    expect(base.radius).toBeGreaterThan(1_000)
    // Деталь растёт вместе с корпусом: тот же множитель — на своём месте.
    expect(fix.size / sizeBefore).toBeCloseTo(base.radius / 1_000)
  })

  it('статуя меняет размер в пределах от исходного', () => {
    const statue = { radius: 5_000 } as { radius: number; baseRadius?: number }
    rayOnStatue(statue as never, 'shrink', 10, 100)
    expect(statue.radius).toBeCloseTo(5_000 * RAYS.MIN_SCALE)
  })

  // Пойманный баг: луч искал корабль по ПАСПОРТНОМУ радиусу — раздутый лучом борт ловился
  // шариком в центре. Радиус цели — с масштабом, как у столкновений и рендера.
  it('луч попадает в раздутый корабль по его настоящему размеру', () => {
    const world = scene()
    const enemy = world.ships[0]!
    // Вдали от станции и тел системы: тест про корпус, а не про то, что стоит на пути.
    const far = new Vector3(5e9, 0, 0)
    enemy.state.pos.copy(far).add(new Vector3(0, 0, -2000))
    enemy.state.scale = 100
    const r = enemy.spec.hull.radius * 100
    // Луч мимо паспортного шарика, но внутри раздутого корпуса.
    const from = far.clone().add(new Vector3(r * 0.5, 0, 0))
    const hit = castLaser(world, from, new Vector3(0, 0, -1), { id: world.player.id, cloaked: false }, 4000)
    expect(hit.ship).toBe(enemy)
  })
})

describe('КПД добычи', () => {
  const podOre = (laser: LaserModule) => {
    const world = scene()
    world.ships.length = 0
    // Мелочь — не колется, сразу рассыпается: руда целиком по КПД ствола.
    const a = rock(world, ASTEROID.MIN_SPLIT_RADIUS * 0.9)
    const hit = {
      distance: 0, ship: null, asteroid: a, warBase: null, warBaseFixture: null,
      missile: null, platform: null, station: null, statue: null, titan: null,
    }
    resolveLaserHit(world, a.pos.clone(), hit, laser.damage, false, world.player.id, {
      effect: laser.effect ?? 'blast',
      rate: 0,
      seconds: 0,
      oreYield: strikeYield(laser.effect, laser.oreYield),
    })
    return world.pods.reduce((n, p) => n + (p.item.kind === 'commodity' ? p.item.units : 0), 0)
  }

  // Военный (по умолчанию у всех) рассыпает камень, теряя половину руды пылью; горный бережёт.
  it('горный приносит руды больше, чем военный', () => {
    expect(podOre(MINING_LASER)).toBeGreaterThan(podOre(PULSE_LASER))
  })

  // Технический лазер качается в КПД добычи, а не в урон: инструмент, а не оружие.
  it('прокачка горного растит КПД, а не урон', () => {
    const up = withUpgrade(MINING_LASER, 0.25)
    if (up.kind !== 'laser') throw new Error('лазер остаётся лазером')
    expect(up.oreYield!).toBeGreaterThan(MINING_LASER.oreYield!)
    expect(up.damage).toBe(MINING_LASER.damage)
  })
})

describe('лучи по киту', () => {
  // Пойманный баг: кита («Атлас») луч не находил вовсе — болты и лучи шли сквозь город-корабль,
  // и переделки на нём не работали. Кит — твердь и цель для переделок.
  it('луч находит кита, а увеличивающий его растит', () => {
    const world = scene()
    world.ships.length = 0
    const far = new Vector3(5e9, 0, 0)
    const titan = {
      id: world.ids.next(), kind: 'titan' as const, variant: 0, name: '«Атлас»',
      pos: far.clone().add(new Vector3(0, 0, -2000)), vel: new Vector3(10, 0, 0), quat: new Quaternion(),
      spin: 0, radius: 1_600,
    }
    world.titans.push(titan)
    const hit = castLaser(world, far, new Vector3(0, 0, -1), { id: world.player.id, cloaked: false }, 4000)
    expect(hit.titan).toBe(titan)
    for (let i = 0; i < 8; i++) {
      resolveLaserHit(world, far.clone(), hit, 0, false, world.player.id, { effect: 'grow', rate: 0.7, seconds: 0.25, oreYield: 1 })
    }
    expect(titan.radius).toBeGreaterThan(1_600)
    resolveLaserHit(world, far.clone(), hit, 0, false, world.player.id, { effect: 'hold', rate: 4, seconds: 2, oreYield: 1 })
    expect(titan.vel.length()).toBeLessThan(0.01)
  })
})
