import { Quaternion, Vector3 } from 'three'
import { GUNNERY } from '../../config/weapons'
import { shipAxes } from '../flight/axes'
import { isLaser, isMissile } from '../loadout'
import type { MissileEntity, ShipEntity, World } from '../world/entities'
import { applyDamage } from './damage'
import { spawnExplosion, spawnTracer } from './effects'
import { castLaser } from './raycast'

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _muzzle = new Vector3()
const _convergence = new Vector3()
const _dir = new Vector3()
const _hitPos = new Vector3()

/** Мировая позиция ствола `mountIndex`. Нужна и симуляции, и рендеру вспышки. */
export function muzzleWorldPos(e: ShipEntity, mountIndex: number, out: Vector3): Vector3 {
  const mount = e.spec.mounts[mountIndex]
  if (!mount) return out.copy(e.state.pos)

  shipAxes(e.state.quat, _fwd, _right, _up)
  const [x, y, z] = mount.hardpoint.offset
  return out
    .copy(e.state.pos)
    .addScaledVector(_right, x)
    .addScaledVector(_up, y)
    // Нос смотрит в -Z, а смещение задано в связанных осях, где +Z назад.
    .addScaledVector(_fwd, -z)
}

/**
 * Залп из всех лазеров. Стволы разнесены по крылу и сведены в точку на дистанции
 * CONVERGENCE — поэтому в прицел они попадают только там. Ближе и дальше лучи расходятся,
 * и это честно: так устроена пристрелка настоящего оружия.
 */
export function fireLasers(world: World, e: ShipEntity, hostile: boolean): boolean {
  if (!e.alive) return false

  shipAxes(e.state.quat, _fwd, _right, _up)
  _convergence.copy(e.state.pos).addScaledVector(_fwd, GUNNERY.CONVERGENCE)

  let fired = false

  e.spec.mounts.forEach((mount, i) => {
    if (!isLaser(mount.weapon)) return
    const gun = e.guns[i]
    if (!gun || gun.cooldown > 0 || gun.heat >= 1) return

    const laser = mount.weapon
    gun.cooldown = laser.cooldown
    gun.heat = Math.min(1, gun.heat + laser.heatPerShot)
    fired = true

    muzzleWorldPos(e, i, _muzzle)
    _dir.copy(_convergence).sub(_muzzle).normalize()

    const hit = castLaser(world, _muzzle, _dir, e, laser.range)
    _hitPos.copy(_muzzle).addScaledVector(_dir, hit.distance)
    spawnTracer(world, _muzzle, _hitPos, hostile, laser.id)

    if (hit.ship) {
      applyDamage(hit.ship, laser.damage, world.time)
      spawnExplosion(world, _hitPos, hit.ship.state.vel, 0.6)
    } else if (hit.asteroid) {
      hit.asteroid.hull -= laser.damage
      spawnExplosion(world, _hitPos, hit.asteroid.vel, 0.4)
      if (hit.asteroid.hull <= 0) hit.asteroid.alive = false
    } else if (hit.missile) {
      // Ракета не «повреждается»: у неё нет прочности, только боевая часть.
      hit.missile.alive = false
      spawnExplosion(world, hit.missile.pos, hit.missile.vel, 1.2)
    }
  })

  return fired
}

const _launchQuat = new Quaternion()

/** Пуск ракеты по захваченной цели. Без захвата ракета бесполезна — это её цена. */
export function fireMissile(world: World, e: ShipEntity, targetId: number | null): boolean {
  if (!e.alive || targetId === null) return false

  /**
   * Берём первый ГОТОВЫЙ пилон: с ракетой и без перезарядки.
   *
   * Перезарядка проверяется здесь, а не после выбора. Раньше поиск смотрел только
   * на боезапас, натыкался на занятый пилон и отказывал, хотя соседние висели
   * снаряжённые. Пока на пилоне была ровно одна ракета, баг не проявлялся:
   * опустевший пилон выпадал из поиска сам. Стоило зарядить по две — и залп
   * превращался в одну ракету раз в 0.8 с.
   */
  const index = e.spec.mounts.findIndex(
    (m, i) => isMissile(m.weapon) && (e.guns[i]?.ammo ?? 0) > 0 && (e.guns[i]?.cooldown ?? 0) <= 0,
  )
  if (index < 0) return false

  const mount = e.spec.mounts[index]
  const gun = e.guns[index]
  if (!mount || !gun || !isMissile(mount.weapon)) return false

  gun.ammo -= 1
  gun.cooldown = 0.8 // перезарядка пусковой, не орудия

  muzzleWorldPos(e, index, _muzzle)
  shipAxes(e.state.quat, _fwd, _right, _up)
  _launchQuat.copy(e.state.quat)

  // Сходит с пилона со скоростью носителя и только потом разгоняется. Иначе она
  // исчезает в том же кадре, в котором пущена: 420 м/с — это 3.5 м за шаг физики.
  const launchSpeed = Math.max(1, e.state.vel.dot(_fwd))

  const missile: MissileEntity = {
    id: world.ids.next(),
    kind: 'missile',
    pos: _muzzle.clone(),
    vel: _fwd.clone().multiplyScalar(launchSpeed),
    quat: _launchQuat.clone(),
    module: mount.weapon,
    ownerId: e.id,
    targetId,
    speed: launchSpeed,
    born: world.time,
    alive: true,
  }
  world.missiles.push(missile)
  return true
}

/** Остывание и перезарядка. Зовётся каждый шаг для каждого корабля. */
export function coolGuns(e: ShipEntity, dt: number): void {
  e.spec.mounts.forEach((mount, i) => {
    const gun = e.guns[i]
    if (!gun) return
    gun.cooldown = Math.max(0, gun.cooldown - dt)
    if (isLaser(mount.weapon)) {
      gun.heat = Math.max(0, gun.heat - mount.weapon.heatCool * dt)
    }
  })
}

/** Максимальный перегрев среди стволов — то, что показывает HUD. */
export function peakHeat(e: ShipEntity): number {
  let max = 0
  for (const gun of e.guns) if (gun.heat > max) max = gun.heat
  return max
}

/** Осталось ракет всего. */
export function missileAmmo(e: ShipEntity): number {
  let total = 0
  e.spec.mounts.forEach((mount, i) => {
    if (isMissile(mount.weapon)) total += e.guns[i]?.ammo ?? 0
  })
  return total
}
