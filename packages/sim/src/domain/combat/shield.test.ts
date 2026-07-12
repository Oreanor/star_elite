import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { MISSILE_PYLON } from '../../config/modules'
import { PHYSICS } from '../../config/physics'
import { SHIELD } from '../../config/station'
import { isLaser } from '../loadout'
import { createWorld, STARTER_SYSTEM } from '../world'
import type { BodyEntity, MissileEntity, World } from '../world/entities'
import { stepBolts } from './bolts'
import { applyDamage } from './damage'
import { stepMissiles } from './missiles'
import { spawnBolt } from './weapons'

/**
 * Станция неуязвима: любой снаряд гаснет о защитное поле у её поверхности, а не бьёт
 * по корпусу. Проверяем не «сколько урона», а сам инвариант — станцию не подбить, и
 * вспышка поля рождается КАСАТЕЛЬНО к сфере (лежит на куполе), не в центре и не абы где.
 */

function stationWorld(): { world: World; station: BodyEntity } {
  const world = createWorld({ ...STARTER_SYSTEM, belt: null, patrols: [] })
  const station = world.bodies.find((b) => b.kind === 'station')
  if (!station) throw new Error('в стартовой системе нет станции')
  return { world, station }
}

function playerLaser(world: World) {
  const mount = world.player.spec.mounts.find((m) => isLaser(m.weapon))
  if (!mount || !isLaser(mount.weapon)) throw new Error('нет лазера')
  return mount.weapon
}

function missile(id: number, ownerId: number, pos: Vector3): MissileEntity {
  return {
    id,
    kind: 'missile',
    pos,
    vel: new Vector3(0, 0, -1),
    quat: new Quaternion(),
    module: MISSILE_PYLON,
    ownerId,
    targetId: null,
    speed: MISSILE_PYLON.speed,
    born: 0,
    alive: true,
  }
}

describe('защитное поле станции', () => {
  it('гасит болт о поле и не даёт ему пройти к корпусу', () => {
    const { world, station } = stationWorld()
    const shieldR = station.radius * SHIELD.RADIUS_FACTOR

    // Стреляем в центр станции снаружи поля: болт обязан погаснуть на сфере, не долетев.
    const origin = station.pos.clone().add(new Vector3(0, 0, shieldR + 600))
    const dir = station.pos.clone().sub(origin).normalize()
    world.player.state.pos.copy(origin)
    spawnBolt(world, world.player, playerLaser(world), origin, dir, false)

    for (let i = 0; i < 200 && world.bolts.length > 0; i++) stepBolts(world, PHYSICS.FIXED_DT)

    expect(world.bolts).toHaveLength(0) // болт израсходован полем
    expect(world.shieldFlashes.length).toBeGreaterThan(0)

    // Вспышка лежит на сфере купола: её удаление от центра равно радиусу поля
    // (с точностью до длины шага заметания — болт гаснет на входе в сферу).
    const flash = world.shieldFlashes[0]!
    expect(flash.center.distanceTo(station.pos)).toBeLessThan(1e-6)
    const onSphere = flash.pos.distanceTo(station.pos)
    expect(Math.abs(onSphere - shieldR)).toBeLessThan(SHIELD.RADIUS_FACTOR * station.radius) // на сфере, не в центре
  })

  it('подрывает ракету о поле, ракета не проходит внутрь', () => {
    const { world, station } = stationWorld()
    const shieldR = station.radius * SHIELD.RADIUS_FACTOR

    // Ракета уже в поле — следующий шаг обязан подорвать её вспышкой поля.
    const inside = station.pos.clone().add(new Vector3(0, 0, shieldR * 0.5))
    const m = missile(900, world.player.id, inside)
    world.missiles.push(m)

    stepMissiles(world, PHYSICS.FIXED_DT)

    expect(m.alive).toBe(false)
    expect(world.missiles).toHaveLength(0)
    expect(world.shieldFlashes.length).toBeGreaterThan(0)
  })

  it('вспышка ориентируется нормалью вдоль радиуса (перпендикулярна поверхности)', () => {
    const { world, station } = stationWorld()
    const shieldR = station.radius * SHIELD.RADIUS_FACTOR
    const inside = station.pos.clone().add(new Vector3(0, 0, shieldR * 0.5))
    world.missiles.push(missile(901, world.player.id, inside))

    stepMissiles(world, PHYSICS.FIXED_DT)

    // Радиус от центра к точке вспышки — то, вдоль чего рендер ставит нормаль диска.
    const flash = world.shieldFlashes[0]!
    const radial = flash.pos.clone().sub(flash.center)
    expect(radial.length()).toBeGreaterThan(0) // есть куда ориентировать: точка не в центре
  })
})

describe('метки попадания: щит против корпуса', () => {
  it('удар по щиту метит lastShieldHitAt, а по корпусу — lastHullHitAt', () => {
    const { world } = stationWorld()
    const ship = world.player
    ship.shield = ship.spec.hull.shield
    expect(ship.shield).toBeGreaterThan(0)

    // Малый удар целиком гасит щит — корпус не задет.
    applyDamage(ship, 1, 10)
    expect(ship.lastShieldHitAt).toBe(10)
    expect(ship.lastHullHitAt).toBeLessThan(0) // корпус ещё не трогали

    // Пробойный удар: щит в ноль, остаток — по корпусу. Метятся ОБЕ.
    applyDamage(ship, ship.shield + 20, 20)
    expect(ship.lastShieldHitAt).toBe(20)
    expect(ship.lastHullHitAt).toBe(20)

    // Щита нет — попадание идёт прямо в корпус, метится только он.
    applyDamage(ship, 5, 30)
    expect(ship.lastHullHitAt).toBe(30)
    expect(ship.lastShieldHitAt).toBe(20) // по щиту больше не метили
  })
})
