import { Quaternion, Vector3 } from 'three'
import { GUNNERY } from '../../config/weapons'
import { shipAxes } from '../flight/axes'
import { phasedOut } from '../scale/scale'
import { isLaser, isMissile, type LaserModule } from '../loadout'
import type { BoltEntity, MissileEntity, ShipEntity, World } from '../world/entities'

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _muzzle = new Vector3()
const _convergence = new Vector3()
const _dir = new Vector3()

/** Мировая позиция связанного смещения [x,y,z] (нос в -Z, +z назад). Оси уже посчитаны. */
function offsetToWorld(e: ShipEntity, offset: readonly [number, number, number], out: Vector3): Vector3 {
  const [x, y, z] = offset
  return out
    .copy(e.state.pos)
    .addScaledVector(_right, x)
    .addScaledVector(_up, y)
    // Нос смотрит в -Z, а смещение задано в связанных осях, где +Z назад.
    .addScaledVector(_fwd, -z)
}

/** Мировая позиция ствола `mountIndex` (по `offset` — центр установки). Нужна рендеру вспышки. */
export function muzzleWorldPos(e: ShipEntity, mountIndex: number, out: Vector3): Vector3 {
  const mount = e.spec.mounts[mountIndex]
  if (!mount) return out.copy(e.state.pos)
  shipAxes(e.state.quat, _fwd, _right, _up)
  return offsetToWorld(e, mount.hardpoint.offset, out)
}

/**
 * Залп из всех лазеров. Стволы разнесены по крылу и сведены в точку на дистанции
 * CONVERGENCE — поэтому в прицел они попадают только там. Ближе и дальше лучи расходятся,
 * и это честно: так устроена пристрелка настоящего оружия.
 *
 * Лазер выпускает БОЛТ (снаряд), а не бьёт мгновенно: попадание случится позже, в
 * `stepBolts`, когда болт долетит. Здесь только рождается снаряд и тратится ствол.
 */
export function fireLasers(world: World, e: ShipEntity, hostile: boolean): boolean {
  if (!e.alive) return false
  // Фаза: ушёл в «большой мир» (крупнее кораблей) — стрелять уже не в кого, лазер молчит.
  // Болт в реальных метрах у центра гиганта всё равно был бы невидимой бессмыслицей.
  if (phasedOut(e.state.scale)) return false

  shipAxes(e.state.quat, _fwd, _right, _up)
  _convergence.copy(e.state.pos).addScaledVector(_fwd, GUNNERY.CONVERGENCE)

  let fired = false

  e.spec.mounts.forEach((mount, i) => {
    if (!isLaser(mount.weapon)) return
    const gun = e.guns[i]
    // Перегрет? Ствол молчит: либо докалился до предела, либо ещё в окне отключки охлаждения.
    if (!gun || gun.cooldown > 0 || gun.heat >= 1 || gun.overheatUntil > world.time) return

    const laser = mount.weapon
    // Перезаряд и нагрев — на УСТАНОВКУ, раз за залп, а не на каждое дуло: два ствола
    // одного оружия греются как один. Иначе многодульный лазер стрелял бы вдвое реже.
    // Тепло набирается с глобальным множителем HEAT_RATE (вчетверо медленнее паспортного).
    gun.cooldown = laser.cooldown
    gun.heat = Math.min(1, gun.heat + laser.heatPerShot * GUNNERY.HEAT_RATE)
    // Достиг предела — ПЕРЕГРЕВ: глохнет на фиксированные секунды (за них остынет наполовину).
    if (gun.heat >= 1) gun.overheatUntil = world.time + GUNNERY.LASER_OVERHEAT_LOCK
    fired = true

    // Дула установки. Нет списка — одно дуло в `offset`. Общая мощность делится поровну:
    // два дула — по половине урона, в сумме тот же лазер.
    //
    // Множитель урона = МАСШТАБ стрелка (миелофон: вырос ×100 — бьёшь ×100) × УСИЛИТЕЛЬ
    // корпуса (`laserAmp`: у «корабля поколений» ×1000, у обычных 1). Оба честные свойства
    // мира, а не привилегия игрока: то же и у ботов. Так гигант дерётся с гигантом по логике.
    const amp = e.state.scale * (e.loadout.chassis.laserAmp ?? 1)
    const nozzles = mount.hardpoint.nozzles ?? [mount.hardpoint.offset]
    const perNozzle = (laser.damage / nozzles.length) * amp
    for (const nozzle of nozzles) {
      offsetToWorld(e, nozzle, _muzzle)
      // Нацелен в точку сведения: болт наследует направление ствола, но не скорость носителя.
      _dir.copy(_convergence).sub(_muzzle).normalize()
      spawnBolt(world, e, laser, _muzzle, _dir, hostile, perNozzle)
      // Дульная вспышка у среза: шарик прикрывает торец ствола. Храним стрелка и связанное
      // смещение (не мировую точку) — рендер держит шарик у дула, пока корабль едет.
      world.muzzleFlashes.push({ shooterId: e.id, offset: nozzle, weapon: laser.id, born: world.time })
    }
  })

  return fired
}

/**
 * Родить лазерный болт из ствола. Позиция и направление уже посчитаны стрелком.
 * `damage` по умолчанию — паспортный урон лазера; многодульная установка передаёт долю.
 */
export function spawnBolt(
  world: World,
  shooter: ShipEntity,
  laser: LaserModule,
  origin: Vector3,
  dir: Vector3,
  hostile: boolean,
  damage: number = laser.damage,
): void {
  const bolt: BoltEntity = {
    id: world.ids.next(),
    kind: 'bolt',
    pos: origin.clone(),
    vel: dir.clone().multiplyScalar(GUNNERY.BOLT_SPEED),
    ownerId: shooter.id,
    hostile,
    cloaked: shooter.cloaked,
    damage,
    weapon: laser.id,
    distanceLeft: laser.range,
    born: world.time,
    alive: true,
  }
  world.bolts.push(bolt)
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
export function coolGuns(e: ShipEntity, now: number, dt: number): void {
  // Пока ствол в отключке перегрева — остывает к ПОЛОВИНЕ ровно за время отключки
  // (не своим heatCool, иначе к разблокировке он был бы уже холодным или ещё горячим).
  const lockRate = (1 - GUNNERY.LASER_OVERHEAT_HALF) / GUNNERY.LASER_OVERHEAT_LOCK
  e.spec.mounts.forEach((mount, i) => {
    const gun = e.guns[i]
    if (!gun) return
    gun.cooldown = Math.max(0, gun.cooldown - dt)
    if (isLaser(mount.weapon)) {
      if (gun.overheatUntil > now) {
        gun.heat = Math.max(GUNNERY.LASER_OVERHEAT_HALF, gun.heat - lockRate * dt)
      } else {
        gun.heat = Math.max(0, gun.heat - mount.weapon.heatCool * dt)
      }
    }
  })
}

/** Есть ли ствол в отключке перегрева прямо сейчас — HUD мигает «ОХЛАЖДЕНИЕ». */
export function laserOverheated(e: ShipEntity, now: number): boolean {
  return e.guns.some((g) => g.overheatUntil > now)
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
