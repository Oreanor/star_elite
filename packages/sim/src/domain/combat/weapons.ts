import { Quaternion, Vector3 } from 'three'
import { GUNNERY } from '../../config/weapons'
import { aimDirection, shipAxes } from '../flight/axes'
import { phasedOut } from '../scale/scale'
import { isLaser, isMissile, type LaserModule } from '../loadout'
import type { BoltEntity, MissileEntity, ShipEntity, World } from '../world/entities'
import { resolveLaserHit } from './bolts'
import { castLaser } from './raycast'

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _muzzle = new Vector3()
const _convergence = new Vector3()
const _aim = new Vector3()
const _dir = new Vector3()
const _beamHit = new Vector3()
/** Стрелок глазами непрерывного луча: по своему id луч в себя не бьёт (как и болт). */
const _beamShooter = { id: 0, cloaked: false }

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
export function fireLasers(world: World, e: ShipEntity, hostile: boolean, dt: number): boolean {
  if (!e.alive) return false
  // Фаза: ушёл в «большой мир» (крупнее кораблей) — стрелять уже не в кого, лазер молчит.
  // Болт в реальных метрах у центра гиганта всё равно был бы невидимой бессмыслицей.
  if (phasedOut(e.state.scale)) return false

  shipAxes(e.state.quat, _fwd, _right, _up)
  // Сводим стволы в точку ПРИЦЕЛА, а не жёстко по носу: над поверхностью корпус держат
  // ровным ради тяги вдоль сферы, и целятся линией огня (`aimPitch`). При нулевом
  // прицеле — тот же вектор носа, что и был, поэтому в космосе ничего не меняется.
  aimDirection(e.state.quat, e.controls.aimPitch, _aim)
  _convergence.copy(e.state.pos).addScaledVector(_aim, GUNNERY.CONVERGENCE)

  let fired = false

  e.spec.mounts.forEach((mount, i) => {
    if (!isLaser(mount.weapon)) return
    const gun = e.guns[i]
    // Перегрет? Ствол молчит: либо докалился до предела, либо ещё в окне отключки охлаждения.
    // Перезаряд проверяем НИЖЕ: у непрерывного луча тот же счётчик работает не задержкой
    // между выстрелами, а темпом попаданий (см. ветку `laser.beam`).
    if (!gun || gun.heat >= 1 || gun.overheatUntil > world.time) return

    const laser = mount.weapon
    const amp = e.state.scale * (e.loadout.chassis.laserAmp ?? 1)

    /**
     * НЕПРЕРЫВНЫЙ ЛУЧ. Не очередь снарядов, а струя: пока держат гашетку, она льётся,
     * и урон идёт ЗА СЕКУНДУ. Перезаряда нет — прерывать нечего; греется тоже за секунду,
     * и перегрев глушит ствол ровно так же, как импульсный.
     */
    if (laser.beam) {
      gun.heat = Math.min(1, gun.heat + laser.heatPerShot * dt * GUNNERY.HEAT_RATE)
      if (gun.heat >= 1) gun.overheatUntil = world.time + GUNNERY.LASER_OVERHEAT_LOCK
      fired = true
      /**
       * УРОН ПОРЦИЯМИ, а не каждый шаг. Струя выглядит непрерывной, но события боя —
       * обида, поломка железа, искра, отсылка попадания чужому клиенту — обязаны идти
       * человеческим темпом: на 120 Гц шаг за шагом это 120 претензий и 18 поломок в
       * секунду, то есть мгновенная война и разобранный корабль. Поэтому тик в секундах
       * (`BEAM_TICK`), а порция = урон/с × длина тика: секундный урон от герцовки не зависит.
       */
      const tick = gun.cooldown <= 0
      if (tick) gun.cooldown = GUNNERY.BEAM_TICK
      const bore = mount.hardpoint.bore ?? 1
      for (const nozzle of mount.hardpoint.nozzles ?? [mount.hardpoint.offset]) {
        pourBeam(world, e, laser, nozzle, hostile, tick ? amp * GUNNERY.BEAM_TICK * bore : 0, bore, _convergence)
      }
      return
    }

    // Импульсный ждёт перезаряд.
    if (gun.cooldown > 0) return

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
    // Множитель урона `amp` (посчитан выше) = МАСШТАБ стрелка (миелофон: вырос ×100 —
    // бьёшь ×100) × УСИЛИТЕЛЬ корпуса (`laserAmp`: у «корабля поколений» ×1000). Оба —
    // честные свойства мира, а не привилегия игрока: то же и у ботов.
    const nozzles = mount.hardpoint.nozzles ?? [mount.hardpoint.offset]
    // Калибр ТОЧКИ (нос — вдвое) множит и урон, и толщину: место решает, не ствол.
    const bore = mount.hardpoint.bore ?? 1
    const perNozzle = (laser.damage / nozzles.length) * amp * bore
    for (const nozzle of nozzles) {
      offsetToWorld(e, nozzle, _muzzle)
      // Нацелен в точку сведения: болт наследует направление ствола, но не скорость носителя.
      _dir.copy(_convergence).sub(_muzzle).normalize()
      spawnBolt(world, e, laser, _muzzle, _dir, hostile, perNozzle, nozzle, bore)
      // Дульная вспышка у среза: шарик прикрывает торец ствола. Храним стрелка и связанное
      // смещение (не мировую точку) — рендер держит шарик у дула, пока корабль едет.
      world.muzzleFlashes.push({ shooterId: e.id, offset: nozzle, weapon: laser.id, born: world.time, bore })
    }
  })

  return fired
}

/**
 * Пролить непрерывный луч из одного дула за шаг.
 *
 * Луч не летит — он ДОСТАЁТ: тем же `castLaser`, что и болт, только сразу на всю дальность.
 * Значит и правила попадания те же (маскировка, свои-чужие, неуязвимая станция), а разница
 * лишь в темпе урона: `share` уже несёт множитель стрелка И длительность шага, поэтому
 * секундный урон не зависит от герцовки — иначе на 240 Гц струя жгла бы вдвое быстрее.
 */
function pourBeam(
  world: World,
  e: ShipEntity,
  laser: LaserModule,
  nozzle: readonly [number, number, number],
  hostile: boolean,
  share: number,
  bore: number,
  convergence: Vector3,
): void {
  offsetToWorld(e, nozzle, _muzzle)
  _dir.copy(convergence).sub(_muzzle).normalize()

  _beamShooter.id = e.id
  _beamShooter.cloaked = e.cloaked
  const hit = castLaser(world, _muzzle, _dir, _beamShooter, laser.range)
  const struck = hit.distance < laser.range

  // `share` = 0 в шагах между тиками: струя рисуется, но урон и события не идут.
  if (struck && share > 0) {
    _beamHit.copy(_muzzle).addScaledVector(_dir, hit.distance)
    resolveLaserHit(world, _beamHit, hit, laser.damage * share, hostile)
  }

  // Рендеру: стрелок и связанное смещение, а не мировая точка, — струя держится у дула,
  // пока корабль летит. Список эфемерный, его пересобирает каждый шаг стрельбы.
  world.beams.push({
    shooterId: e.id,
    offset: nozzle,
    dir: _dir.clone(),
    length: hit.distance,
    hit: struck,
    weapon: laser.id,
    hostile,
    bore,
  })
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
  /** Связанное смещение дула — держит хвост первого следа у ствола на ходу. */
  muzzle?: readonly [number, number, number],
  /** Калибр точки: носовой болт вдвое толще и больнее крыльевого. */
  bore = 1,
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
    muzzle,
    bore,
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
  e.spec.mounts.forEach((mount, i) => {
    const gun = e.guns[i]
    if (!gun) return
    gun.cooldown = Math.max(0, gun.cooldown - dt)
    if (!isLaser(mount.weapon)) return

    if (gun.overheatUntil > now) {
      // ОТКЛЮЧКА: держим нагрев на упоре. Сползающая шкала обещала бы скорый выстрел,
      // которого не будет, — ствол занят все LOCK секунд, и полоса обязана это показывать.
      gun.heat = 1
      return
    }
    if (gun.overheatUntil > 0) {
      // Срок вышел — отпускаем разом: нагрев валится до половины, и это видимый сигнал
      // «можно снова», а не незаметное продолжение прежнего сползания.
      gun.overheatUntil = 0
      gun.heat = GUNNERY.LASER_OVERHEAT_HALF
      return
    }
    gun.heat = Math.max(0, gun.heat - mount.weapon.heatCool * dt)
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

/**
 * СРЕДНИЙ нагрев по всем стволам — то, что показывает шкала «ЛАЗЕР».
 *
 * Пик врал бы о состоянии батареи стволов: один перегретый ствол из трёх задирал бы полосу
 * на упор, хотя стрелять есть чем. Каждый ствол греется своим шагом (`heatPerShot`), а
 * общая картина — их среднее. Прицел при этом живёт по ПИКУ: он предупреждает, что
 * какой-то ствол вот-вот замолчит.
 */
export function meanHeat(e: ShipEntity): number {
  let sum = 0
  let count = 0
  e.spec.mounts.forEach((mount, i) => {
    const gun = e.guns[i]
    if (!gun || !isLaser(mount.weapon)) return
    sum += gun.heat
    count++
  })
  return count > 0 ? sum / count : 0
}

/** Осталось ракет всего. */
export function missileAmmo(e: ShipEntity): number {
  let total = 0
  e.spec.mounts.forEach((mount, i) => {
    if (isMissile(mount.weapon)) total += e.guns[i]?.ammo ?? 0
  })
  return total
}
