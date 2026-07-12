import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { GUNNERY } from '../../config/weapons'
import { PHYSICS } from '../../config/physics'
import { createWorld, STARTER_SYSTEM } from '../world'
import type { ShipEntity, World } from '../world/entities'
import { isLaser } from '../loadout'
import { stepBolts } from './bolts'
import { spawnBolt } from './weapons'

function withOneEnemy(): { world: World; enemy: ShipEntity } {
  const world = createWorld({
    ...STARTER_SYSTEM,
    belt: null,
    patrols: [{ count: 1, at: [0, 0, -500], spread: 0, faction: 'hostile', name: 'Пират' }],
  })
  return { world, enemy: world.ships[0]! }
}

/** Первый лазер игрока — источник урона и дальности для прямого спавна болта. */
function playerLaser(world: World) {
  const mount = world.player.spec.mounts.find((m) => isLaser(m.weapon))
  if (!mount || !isLaser(mount.weapon)) throw new Error('нет лазера')
  return mount.weapon
}

/** Гонит болты, пока не разрешатся или не выйдет лимит шагов. */
function settle(world: World, steps = 200): void {
  for (let i = 0; i < steps && world.bolts.length > 0; i++) stepBolts(world, PHYSICS.FIXED_DT)
}

describe('лазерный болт', () => {
  /**
   * Заметание, а не точка. За шаг физики болт проходит ~200 м — куда больше корабля.
   * Точечная проверка «где болт сейчас» пролетала бы сквозь цель между шагами; отрезок
   * шага её ловит. Ставим цель на 2 км — заведомо много шагов — и наводим болт точно в неё.
   */
  it('заметает цель, стоящую между шагами, а не проскакивает её', () => {
    const { world, enemy } = withOneEnemy()
    world.player.state.pos.set(0, 0, 0)
    enemy.state.pos.set(0, 0, -2000)
    enemy.state.vel.set(0, 0, 0)
    const before = enemy.shield

    const laser = playerLaser(world)
    spawnBolt(world, world.player, laser, new Vector3(0, 0, 0), new Vector3(0, 0, -1), false)
    settle(world)

    expect(enemy.shield).toBe(before - laser.damage)
    expect(world.bolts).toHaveLength(0) // болт израсходован попаданием
  })

  /** Скорость постоянна и одна на всех: за шаг болт проходит ровно BOLT_SPEED·dt. */
  it('летит с постоянной скоростью BOLT_SPEED', () => {
    const { world } = withOneEnemy()
    const laser = playerLaser(world)
    spawnBolt(world, world.player, laser, new Vector3(0, 0, 0), new Vector3(0, 0, -1), false)
    const bolt = world.bolts[0]!

    stepBolts(world, PHYSICS.FIXED_DT)
    expect(-bolt.pos.z).toBeCloseTo(GUNNERY.BOLT_SPEED * PHYSICS.FIXED_DT, 3)
  })

  /**
   * Регрессия. Болт стартует ВНУТРИ сферы своего носителя. Если не исключить владельца
   * по id, первый же шаг «попадёт» в стрелка, и снаряд умрёт у ствола, не долетев.
   * Раньше в `castLaser` уходил сам болт, чей `id` — id снаряда, а не владельца.
   */
  it('не попадает в собственного стрелка на старте', () => {
    const { world } = withOneEnemy()
    const p = world.player
    p.state.pos.set(0, 0, 0)
    const beforeHull = p.hull
    const beforeShield = p.shield

    const laser = playerLaser(world)
    // Наводим болт НАЗАД, сквозь центр носителя: не будь исключения — попал бы в себя.
    spawnBolt(world, p, laser, p.state.pos.clone(), new Vector3(0, 0, 1), false)
    stepBolts(world, PHYSICS.FIXED_DT)

    expect(p.hull).toBe(beforeHull)
    expect(p.shield).toBe(beforeShield)
  })

  /**
   * Авторитет над своим HP. Кинематический борт — это чужой игрок, чьё здоровье живёт на его
   * клиенте. Болт по нему НЕ наносит урон локально (иначе два клиента разошлись бы в его HP),
   * а регистрирует попадание в `remoteHits` — слой сети перешлёт урон владельцу, он ударит сам.
   */
  it('по кинематическому борту не бьёт локально, а регистрирует попадание', () => {
    const { world, enemy } = withOneEnemy()
    enemy.kinematic = true
    world.player.state.pos.set(0, 0, 0)
    enemy.state.pos.set(0, 0, -1000)
    enemy.state.vel.set(0, 0, 0)
    const beforeShield = enemy.shield

    const laser = playerLaser(world)
    spawnBolt(world, world.player, laser, new Vector3(0, 0, 0), new Vector3(0, 0, -1), false)
    settle(world)

    expect(enemy.shield).toBe(beforeShield) // локально HP чужого не тронуто
    expect(world.remoteHits).toEqual([{ targetId: enemy.id, damage: laser.damage }])
  })

  /** Болт гаснет на пределе дальности лазера, а не летит вечно. */
  it('гаснет, пройдя дальность лазера, и никого дальше не задевает', () => {
    const { world, enemy } = withOneEnemy()
    const laser = playerLaser(world)
    // Цель дальше дальности оружия — болт не должен до неё дотянуть.
    enemy.state.pos.set(0, 0, -(laser.range + 500))
    const before = enemy.shield

    spawnBolt(world, world.player, laser, new Vector3(0, 0, 0), new Vector3(0, 0, -1), false)
    settle(world, 400)

    expect(world.bolts).toHaveLength(0)
    expect(enemy.shield).toBe(before) // не долетел
  })
})
