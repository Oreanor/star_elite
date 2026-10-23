import { Quaternion, Vector3 } from 'three'
import { COSMIC, GUNNERY } from '../../config/weapons'
import { aimDirection, gunQuat, shipAxes } from '../flight/axes'
import { phasedOut } from '../scale/scale'
import { isLaser, isMissile, type LaserModule } from '../loadout'
import { armMissileReload, missileStock, retuneMissileMass, spendMissile, stepMissileReload } from './ordnance'
import type { BoltEntity, MissileEntity, ShipEntity, World } from '../world/entities'
import { applyRay, resolveLaserHit, strikeYield, type LaserStrike } from './bolts'
import { isRayEffect } from './laserEffects'
import { castLaser } from './raycast'
import { chargeBallCenter, chargeBallRadius, isCosmic, pourSeed, spawnPulse } from './cosmic'

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _gunQ = new Quaternion()
const _muzzle = new Vector3()
const _convergence = new Vector3()
const _aim = new Vector3()
const _dir = new Vector3()
const _beamHit = new Vector3()
/** Стрелок глазами непрерывного луча: по своему id луч в себя не бьёт (как и болт). */
const _beamShooter = { id: 0, cloaked: false }
const _beamStrike: LaserStrike = { effect: 'blast', rate: 0, seconds: 0, oreYield: 1 }
const _rayStrike: LaserStrike = { effect: 'hold', rate: 0, seconds: 0, oreYield: 1 }

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
  // Дула — по позе стволов: над поверхностью они наклонены за прицелом вместе с носом.
  shipAxes(gunQuat(e.state.quat, e.controls.aimPitch, _gunQ), _fwd, _right, _up)
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
export function fireLasers(world: World, e: ShipEntity, hostile: boolean, dt: number, cosmetic = false): boolean {
  if (!e.alive) return false
  // Фаза: ушёл в «большой мир» (крупнее кораблей) — стрелять уже не в кого, лазер молчит.
  // Болт в реальных метрах у центра гиганта всё равно был бы невидимой бессмыслицей.
  // Кроме КОСМИЧЕСКИХ: их цель — миры, и гиганту они как раз по руке.
  const giant = phasedOut(e.state.scale)

  // Дула — по позе стволов: над поверхностью они наклонены за прицелом вместе с носом.
  shipAxes(gunQuat(e.state.quat, e.controls.aimPitch, _gunQ), _fwd, _right, _up)
  // Сводим стволы в точку ПРИЦЕЛА, а не жёстко по носу: над поверхностью корпус держат
  // ровным ради тяги вдоль сферы, и целятся линией огня (`aimPitch`). При нулевом
  // прицеле — тот же вектор носа, что и был, поэтому в космосе ничего не меняется.
  aimDirection(e.state.quat, e.controls.aimPitch, _aim)
  _convergence.copy(e.state.pos).addScaledVector(_aim, GUNNERY.CONVERGENCE)

  let fired = false
  // Перегрет — молчат ВСЕ: шкала общая. Перезаряд проверяем ниже: у непрерывного луча тот же
  // счётчик работает не задержкой между выстрелами, а темпом попаданий (см. `laser.beam`).
  const heat = e.laserHeat
  if (heat.overheatUntil > world.time) return false
  const group = selectedLaser(e)
  // Разбивающий среди выбранных — гашетка копит его шар, остальные стволы молчат: вся
  // мощность уходит в заряд. Выстрел — по отпусканию (`settlePulseCharges`).
  const charger = shatterMount(e, group)
  if (charger >= 0) return chargePulse(world, e, charger, dt)
  if (heat.heat >= 1) return false
  // Доля ствола в общей шкале: залп ВСЕМИ греет ровно как прежде каждый ствол свой, а
  // стрельба одним — втрое медленнее при трёх лазерах. Отсюда и смысл выбора по X.
  const share = 1 / Math.max(1, laserMountCount(e))

  e.spec.mounts.forEach((mount, i) => {
    if (!isLaser(mount.weapon)) return
    if (group !== null && i !== group) return
    const gun = e.guns[i]
    if (!gun || heat.overheatUntil > world.time) return

    const laser = mount.weapon
    if (giant && !isCosmic(laser.effect)) return
    // Косметический залп зеркала: болт летит и искрит, но урона не несёт (урон — у хозяина).
    const amp = cosmetic ? 0 : e.state.scale * (e.loadout.chassis.laserAmp ?? 1)

    /**
     * НЕПРЕРЫВНЫЙ ЛУЧ. Не очередь снарядов, а струя: пока держат гашетку, она льётся,
     * и урон идёт ЗА СЕКУНДУ. Перезаряда нет — прерывать нечего; греется тоже за секунду,
     * и перегрев глушит ствол ровно так же, как импульсный.
     */
    if (laser.beam) {
      addLaserHeat(e, world.time, laser.heatPerShot * dt * GUNNERY.HEAT_RATE * share)
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
      // Мощность установки делится между дулами поровну — как у импульсных: два дула на
      // законцовках бьют вместе тем же лучом, а не вдвое. Переделка (`stepSeconds`) — нет:
      // это время в луче, а не доля мощности.
      const beamNozzles = mount.hardpoint.nozzles ?? [mount.hardpoint.offset]
      for (const nozzle of beamNozzles) {
        // Засев — удержание мира ВРЕМЕНЕМ: дула одной установки делят секунду, а не множат её.
        const seconds = (amp > 0 ? dt : 0) / (laser.effect === 'seed' ? beamNozzles.length : 1)
        pourBeam(world, e, laser, nozzle, hostile, tick ? (amp * GUNNERY.BEAM_TICK * bore) / beamNozzles.length : 0, bore, _convergence, seconds)
      }
      return
    }

    // Импульсный ждёт перезаряд.
    if (gun.cooldown > 0) return

    // Перезаряд и нагрев — на УСТАНОВКУ, раз за залп, а не на каждое дуло: два ствола
    // одного оружия греются как один. Иначе многодульный лазер стрелял бы вдвое реже.
    // Тепло набирается с глобальным множителем HEAT_RATE (вчетверо медленнее паспортного).
    gun.cooldown = laser.cooldown
    addLaserHeat(e, world.time, laser.heatPerShot * GUNNERY.HEAT_RATE * share)
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
  stepSeconds: number,
): void {
  offsetToWorld(e, nozzle, _muzzle)
  _dir.copy(convergence).sub(_muzzle).normalize()

  // Засевающий: струя по линии прицела, сквозь корабли — до первого тела системы.
  if (laser.effect === 'seed') {
    aimDirection(e.state.quat, e.controls.aimPitch, _dir)
    const reach = laser.range * Math.max(1, e.state.scale)
    const seed = pourSeed(world, e, _muzzle, _dir, reach, stepSeconds)
    world.beams.push({
      shooterId: e.id, offset: nozzle, dir: _dir.clone(), length: seed.distance, hit: seed.body !== null,
      weapon: laser.id, hostile, bore,
    })
    return
  }

  _beamShooter.id = e.id
  _beamShooter.cloaked = e.cloaked
  const hit = castLaser(world, _muzzle, _dir, _beamShooter, laser.range)
  const struck = hit.distance < laser.range

  // Переделка — КАЖДЫЙ шаг, своей длительностью: размер течёт плавно, а не ступенями тиков.
  if (struck && isRayEffect(laser.effect)) {
    _rayStrike.effect = laser.effect!
    _rayStrike.rate = laser.effectRate ?? 0
    _rayStrike.seconds = stepSeconds
    applyRay(hit, _rayStrike)
  }

  // `share` = 0 в шагах между тиками: струя рисуется, но урон и события не идут.
  if (struck && share > 0) {
    _beamHit.copy(_muzzle).addScaledVector(_dir, hit.distance)
    // Переделка уже легла пошагово выше; тик несёт лишь урон, искры и события боя.
    _beamStrike.effect = laser.effect ?? 'blast'
    _beamStrike.rate = laser.effectRate ?? 0
    _beamStrike.seconds = 0
    _beamStrike.oreYield = strikeYield(laser.effect, laser.oreYield)
    resolveLaserHit(world, _beamHit, hit, laser.damage * share, hostile, e.id, _beamStrike)
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
    effect: laser.effect,
    oreYield: laser.oreYield,
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
  // Перезарядка четырёх — все четыре секунды, даже если первая уже села на пилон.
  // Пустая стойка молчит и без таймера: трюм есть, а на пилоне ещё нечего пускать.
  if (e.missileReload > 0 || e.missileReady <= 0) return false
  const index = e.spec.mounts.findIndex(
    (m, i) => isMissile(m.weapon) && (e.guns[i]?.cooldown ?? 0) <= 0,
  )
  if (index < 0) return false

  const mount = e.spec.mounts[index]
  const gun = e.guns[index]
  if (!mount || !gun || !isMissile(mount.weapon)) return false
  // Трюм и стойка разъехались — не пускаем воздух.
  if (!spendMissile(e)) {
    e.missileReady = missileStock(e)
    return false
  }

  e.missileReady -= 1
  gun.cooldown = 0.8 // перезарядка пусковой, не подача из трюма
  armMissileReload(e)
  // Тонна ушла с борта — ускорения надо пересчитать, стволы при этом не сбрасывать.
  retuneMissileMass(e)

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

/** Установка разбивающего лазера среди выбранных; −1 — нет. */
function shatterMount(e: ShipEntity, group: number | null): number {
  for (let i = 0; i < e.spec.mounts.length; i++) {
    if (group !== null && i !== group) continue
    const w = e.spec.mounts[i]!.weapon
    if (isLaser(w) && w.effect === 'shatter') return i
  }
  return -1
}

/**
 * Такт удержания гашетки на разбивающем: набор растёт за `CHARGE_TIME`, шкала нагрева ведётся
 * от начального значения к упору. Перегрев (и его отключку) набор НЕ вызывает: на полном
 * шар просто держится, сколько держат гашетку, — решать, стрелять ли, пилоту.
 */
function chargePulse(world: World, e: ShipEntity, mount: number, dt: number): boolean {
  const gun = e.guns[mount]
  if (!gun || gun.cooldown > 0) return false
  const heat = e.laserHeat
  let c = e.pulseCharge
  if (!c || c.cancelledAt !== null || c.mount !== mount) {
    c = e.pulseCharge = { mount, level: 0, startHeat: Math.min(heat.heat, 0.99), held: true, cancelledAt: null }
  }
  c.held = true
  c.level = Math.min(1, c.level + dt / COSMIC.CHARGE_TIME)
  heat.heat = c.startHeat + (1 - c.startHeat) * c.level
  heat.lastHeatAt = world.time
  return true
}

/** Начало такта оружия: гашетку ещё никто не держал. */
export function unholdPulseCharges(ships: Iterable<ShipEntity>): void {
  for (const ship of ships) if (ship.pulseCharge) ship.pulseCharge.held = false
}

const _pulseAim = new Vector3()
const _pulseFrom = new Vector3()

/**
 * Конец такта оружия: кто отпустил гашетку — тому итог. Полный заряд — шар летит, и лазеры
 * уходят в отключку перегрева (цена импульса, разносящего мир). Неполный — отмена: шар
 * схлопывается, выстрела нет, шкала остывает как обычно. Отпусканием считается и всё, что
 * гашетку прервало: крейсер, гибель, смена оружия.
 */
export function settlePulseCharges(world: World, ships: Iterable<ShipEntity>): void {
  for (const e of ships) {
    const c = e.pulseCharge
    if (!c) continue
    if (!e.alive) {
      e.pulseCharge = undefined
      continue
    }
    if (c.cancelledAt !== null) {
      if (world.time - c.cancelledAt > COSMIC.CHARGE_FIZZLE) e.pulseCharge = undefined
      continue
    }
    if (c.held) continue
    if (c.level < 1) {
      c.cancelledAt = world.time
      continue
    }
    releasePulse(world, e, c.mount)
    e.pulseCharge = undefined
  }
}

function releasePulse(world: World, e: ShipEntity, mount: number): void {
  const m = e.spec.mounts[mount]
  if (!m || !isLaser(m.weapon)) return
  const laser = m.weapon
  const gun = e.guns[mount]
  if (gun) gun.cooldown = laser.cooldown
  addLaserHeat(e, world.time, 1)
  aimDirection(e.state.quat, e.controls.aimPitch, _pulseAim)
  const radius = chargeBallRadius(e, world.time)
  chargeBallCenter(e.state.pos, _pulseAim, e.spec.hull.radius * e.state.scale, radius, _pulseFrom)
  // Зеркалу шар не положен: правку галактики шлёт хозяин выстрела.
  if (!e.kinematic) spawnPulse(world, e, _pulseFrom, _pulseAim, laser.range * Math.max(1, e.state.scale), radius)
  world.muzzleFlashes.push({ shooterId: e.id, offset: m.hardpoint.offset, weapon: laser.id, born: world.time, bore: m.hardpoint.bore ?? 1 })
}

/** Нагреть общую шкалу. Достиг предела — ПЕРЕГРЕВ: все лазеры глохнут на LOCK секунд. */
function addLaserHeat(e: ShipEntity, now: number, amount: number): void {
  const heat = e.laserHeat
  heat.heat = Math.min(1, heat.heat + amount)
  heat.lastHeatAt = now
  if (heat.heat >= 1) heat.overheatUntil = now + GUNNERY.LASER_OVERHEAT_LOCK
}

/** Сколько лазерных установок на борту. */
function laserMountCount(e: ShipEntity): number {
  let n = 0
  for (const m of e.spec.mounts) if (isLaser(m.weapon)) n++
  return n
}

/** Выбранная установка — если она ещё лазер; иначе null («все»): оснастку могли сменить. */
export function selectedLaser(e: ShipEntity): number | null {
  const g = e.laserGroup
  return g !== null && e.spec.mounts[g] && isLaser(e.spec.mounts[g].weapon) ? g : null
}

/**
 * Следующий выбор по кругу: все → первый лазер → … → последний → все. Один лазер (или ни
 * одного) — выбирать нечего, остаётся «все». Возвращает новый выбор.
 */
export function cycleLaserGroup(e: ShipEntity): number | null {
  const lasers: number[] = []
  e.spec.mounts.forEach((m, i) => {
    if (isLaser(m.weapon)) lasers.push(i)
  })
  const current = selectedLaser(e)
  if (lasers.length <= 1) e.laserGroup = null
  else if (current === null) e.laserGroup = lasers[0]!
  else {
    const at = lasers.indexOf(current)
    e.laserGroup = at >= 0 && at < lasers.length - 1 ? lasers[at + 1]! : null
  }
  return e.laserGroup
}

/** Остывание и перезарядка. Зовётся каждый шаг для каждого корабля. */
export function coolGuns(e: ShipEntity, now: number, dt: number): void {
  stepMissileReload(e, dt)
  let coolSum = 0
  let lasers = 0
  e.spec.mounts.forEach((mount, i) => {
    const gun = e.guns[i]
    if (gun) gun.cooldown = Math.max(0, gun.cooldown - dt)
    if (isLaser(mount.weapon)) {
      coolSum += mount.weapon.heatCool
      lasers++
    }
  })

  const heat = e.laserHeat
  if (heat.overheatUntil > now) {
    // ОТКЛЮЧКА: держим нагрев на упоре. Сползающая шкала обещала бы скорый выстрел,
    // которого не будет, — лазеры заняты все LOCK секунд, и полоса обязана это показывать.
    heat.heat = 1
    return
  }
  if (heat.overheatUntil > 0) {
    // Срок вышел — отпускаем разом: нагрев валится до половины, и это видимый сигнал
    // «можно снова», а не незаметное продолжение прежнего сползания.
    heat.overheatUntil = 0
    heat.heat = GUNNERY.LASER_OVERHEAT_HALF
    return
  }
  // Пока стреляешь — не остывает. Прежде остывание шло и под огнём и было быстрее нагрева
  // (у «Ники» залп всеми +0.08/с против −0.25/с): шкала не росла вовсе, перегрева не было.
  if (now - heat.lastHeatAt < GUNNERY.COOL_DELAY) return
  // Остывает со СРЕДНЕЙ скоростью стволов: при залпе всеми шкала живёт как прежде каждый ствол.
  if (lasers > 0) heat.heat = Math.max(0, heat.heat - (coolSum / lasers) * dt)
}

/** Лазеры в отключке перегрева прямо сейчас — HUD мигает «ОХЛАЖДЕНИЕ». */
export function laserOverheated(e: ShipEntity, now: number): boolean {
  return e.laserHeat.overheatUntil > now
}

/** Нагрев лазеров — шкала общая, пик и среднее совпали. */
export function peakHeat(e: ShipEntity): number {
  return e.laserHeat.heat
}

/** Шкала «ЛАЗЕР»: общий нагрев (прежде — среднее по стволам, когда шкал было несколько). */
export function meanHeat(e: ShipEntity): number {
  return e.laserHeat.heat
}

/** Сколько ракет ещё на борту — в трюме, вместе со стойкой. Пуск смотрит `missileReady`. */
export function missileAmmo(e: ShipEntity): number {
  return missileStock(e)
}
