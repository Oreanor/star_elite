import { Vector3 } from 'three'
import { AI } from '../../config/ai'
import { NPC_DOCK } from '../../config/station'
import { TRAFFIC } from '../../config/world'
import { clamp, signed } from '../../core/math'
import { healthFraction, shieldFraction } from '../combat/damage'
import { shipAxes } from '../flight/axes'
import { bankToward, steerToward } from '../flight/steering'
import { findStation } from '../station/docking'
import type { Controller } from '../sim/controller'
import type { ShipControls } from '../flight/types'
import type { ShipEntity, World } from '../world/entities'
import { breakWaypoint, leadPoint, patrolWaypoint } from './maneuvers'
import { isEngageable } from '../combat/engage'
import { isHostileTo, selectTarget } from './targeting'
import type { AIMode, AIState } from './types'

/**
 * Пилот-бот. Реализует тот же `Controller`, что и игрок: заполняет ShipControls
 * и ничего больше. Физика у него ровно та же — превзойти тебя он может только
 * решением, не привилегией.
 *
 * Слабости смоделированы честно:
 *   • решение пересматривается раз в THINK_INTERVAL — это время реакции;
 *   • прицел дрожит, и дрожание меняется медленно — это рука, а не белый шум;
 *   • разворот ограничен угловым ускорением его же корабля.
 */

/**
 * Горизонт упреждения для СБЛИЖЕНИЯ, не для стрельбы.
 *
 * Лазер попадает в тот же шаг, в котором выпущен, поэтому стрелять надо ПРЯМО в цель.
 * Упреждение при мгновенном оружии — систематический промах: на 300 м оно уводит
 * луч на 16 м при радиусе корабля 12 м. Оно осмысленно только для ракет
 * и на кривой погони, где срезает угол.
 */
const PURSUIT_HORIZON = 900

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _aim = new Vector3()
const _toTarget = new Vector3()
const _dockAim = new Vector3()
const _depart = new Vector3()
const _gate = new Vector3(NPC_DOCK.GATE[0], NPC_DOCK.GATE[1], NPC_DOCK.GATE[2])
const _steer = { pitch: 0, yaw: 0 }

function setMode(ai: AIState, mode: AIMode): void {
  if (ai.mode === mode) return
  ai.mode = mode
  ai.modeTimer = 0
}

export const aiController: Controller = {
  update(e: ShipEntity, world: World, dt: number): void {
    const ai = e.ai
    if (!ai || !e.alive) return

    const c = e.controls
    ai.modeTimer += dt
    ai.wantsFire = false
    ai.wantsMissile = false
    ai.missileCooldown = Math.max(0, ai.missileCooldown - dt)

    // Единственные «часы размышления». Раньше таймер уменьшался внутри decideMode,
    // а decideMode вызывался только при наличии цели — бот без цели не мог её выбрать
    // и патрулировал вечно.
    ai.thinkTimer -= dt
    const rethink = ai.thinkTimer <= 0
    // Выучка растягивает время реакции: слабый пилот думает дольше, а не бьёт слабее.
    if (rethink) ai.thinkTimer = AI.THINK_INTERVAL / ai.skill

    // ПРО решается независимо от цели: ракета летит и в патрулирующего.
    if (rethink) decideEcm(e, ai, world)

    const target = rethink ? selectAndRemember(e, world) : resolveTarget(e, world)
    if (!target) {
      // Стыкующийся к причалу правит на станцию по очереди; прочие — патрулируют.
      if (ai.dock !== null) flyDock(e, ai, world, dt)
      else flyPatrol(e, ai, world.time)
      return
    }

    _toTarget.copy(target.state.pos).sub(e.state.pos)
    const distance = _toTarget.length()

    if (rethink) {
      decideMode(e, ai, target, distance)
      decideMissile(ai, world, distance)
    }
    updateAimJitter(ai, world, distance, dt)

    let throttle: number
    switch (ai.mode) {
      case 'patrol':
        flyPatrol(e, ai, world.time)
        return

      case 'pursue':
        // Кривая погони: срезаем угол, целясь туда, где цель окажется.
        leadPoint(e, target, PURSUIT_HORIZON, _aim)
        throttle = 1
        break

      case 'attack':
        // Оружие мгновенное — ведём нос ПРЯМО в цель. Дрожание руки добавляется здесь.
        _aim.copy(target.state.pos).add(ai.aimJitter)
        // Медленно: ω = v/d, и на боевой скорости цель не удержать в прицеле.
        throttle = distance > AI.ATTACK_SLOW_RANGE ? AI.ATTACK_THROTTLE_FAR : AI.ATTACK_THROTTLE_NEAR
        break

      case 'break':
      case 'evade':
        _aim.copy(ai.waypoint)
        throttle = 1
        break
    }

    steerToward(e.state, _aim, 2.2, _steer)
    c.pitch = _steer.pitch
    c.yaw = _steer.yaw
    c.rudder = 0
    // Крен в цель: тангаж вдвое быстрее рыскания, и разворот выгоднее делать им.
    c.roll = bankToward(e.state, _aim)
    c.flightAssist = true
    c.retro = 0
    c.throttle = throttle

    const escaping = ai.mode === 'break' || ai.mode === 'evade'
    c.boost = escaping ? AI.ESCAPE_BOOST : 1

    // Уклонение змейкой: прямолинейный бот — мишень.
    if (escaping) {
      c.pitch = clamp(c.pitch + Math.sin(world.time * 2.6 + ai.phase) * 0.45, -1, 1)
      c.yaw = clamp(c.yaw + Math.cos(world.time * 1.9 + ai.phase) * 0.3, -1, 1)
    }

    decideFire(e, ai, target, distance)
  },

  wantsFire(e: ShipEntity): boolean {
    return e.ai?.wantsFire ?? false
  },

  wantsMissile(e: ShipEntity): boolean {
    return e.ai?.wantsMissile ?? false
  },

  wantsEcm(e: ShipEntity): boolean {
    return e.ai?.wantsEcm ?? false
  },
}

/**
 * Бить ли по ракете противоракетным импульсом.
 *
 * Ждём, пока ракета подойдёт: `fireEcm` жжёт заряд батарей за каждый подрыв,
 * а на дальней дистанции от ракеты дешевле увернуться. Порог реакции — тот же
 * такт размышления, поэтому идеально вовремя бот не успевает никогда.
 */
function decideEcm(e: ShipEntity, ai: AIState, world: World): void {
  ai.wantsEcm = false
  if (e.ecmCooldown > 0) return

  for (const m of world.missiles) {
    if (!m.alive || m.ownerId === e.id) continue
    if (m.pos.distanceToSquared(e.state.pos) > AI.ECM_RANGE * AI.ECM_RANGE) continue
    // Не всегда: иначе ракета по боту не долетает никогда и перестаёт быть оружием.
    if (world.rng() < AI.ECM_CHANCE) ai.wantsEcm = true
    return
  }
}

/**
 * Пуск ракеты. Решение принимается ТОЛЬКО в такте размышления и не чаще, чем
 * раз в MISSILE_INTERVAL секунд. Вероятность «за шаг физики» дала бы темп,
 * зависящий от частоты симуляции, и бот высыпал бы всю пусковую за десять секунд.
 */
function decideMissile(ai: AIState, world: World, distance: number): void {
  if (ai.mode !== 'attack' || ai.missileCooldown > 0) return
  if (distance < AI.MISSILE_MIN_RANGE || distance > AI.MISSILE_MAX_RANGE) return
  if (world.rng() >= AI.MISSILE_CHANCE) return

  ai.wantsMissile = true
  ai.missileCooldown = AI.MISSILE_INTERVAL
}

/**
 * Наёмник живёт чужой волей: он держится рядом с нанимателем и бьёт того, кого
 * тот захватил. Своей цели он не выбирает — он ведомый, а не второй пилот.
 *
 * Приказ переписывается КАЖДЫЙ такт размышления, а не выдаётся однажды: наниматель
 * меняет захват в бою, и ведомый обязан узнавать об этом со своей задержкой
 * реакции — не мгновенно и не никогда.
 */
function followEscort(e: ShipEntity, world: World): void {
  const ai = e.ai!
  if (ai.escortOf === null) return

  const patron = ai.escortOf === world.player.id ? world.player : world.ships.find((s) => s.id === ai.escortOf)
  if (!patron?.alive) {
    // Нанимателя больше нет. Контракт с мёртвым не исполняют.
    ai.escortOf = null
    ai.orderedTargetId = null
    return
  }

  // Дом наёмника — там, где наниматель: без этого он патрулирует место найма
  // и остаётся позади, стоило игроку тронуться с места.
  ai.home.copy(patron.state.pos)

  const wanted = patron === world.player ? world.lockedTargetId : (patron.ai?.targetId ?? null)
  const enemy = wanted === null ? null : world.ships.find((s) => s.id === wanted)
  // Мирного по приказу не бьют — наёмник не убийца по найму, — а невидимку
  // и стыкующегося просто не берут на прицел.
  ai.orderedTargetId = enemy && isEngageable(enemy) && isHostileTo(e.faction, enemy.faction) ? enemy.id : null
}

function selectAndRemember(e: ShipEntity, world: World): ShipEntity | null {
  const ai = e.ai!
  followEscort(e, world)

  // Приказ отменяет выбор. Иначе в такте размышления пилот перескочил бы
  // на ближайшего врага, и автобой перестал бы драться с тем, кого захватили.
  if (ai.orderedTargetId !== null) {
    ai.targetId = ai.orderedTargetId
    return resolveTarget(e, world)
  }
  // Наёмник ИГРОКА без приказа драки не ищет: иначе автобой перестал бы слушаться
  // захвата, а звено бросалось бы на всё, что мимо пролетело.
  if (ai.escortOf === world.player.id) {
    ai.targetId = null
    return null
  }
  // А вот СТРАЖ конвоя (сопровождает не игрока) волен защищать подопечного сам:
  // у мирного грузовика своей цели нет, и без этого прикрытие лишь красиво летит,
  // пока баржу разбирают на части. Цель выбирает по фракции — полицейский эскорт
  // бьёт налётчика, потому что тот ему враг, а не потому что «так велено».
  if (ai.escortOf !== null) {
    const guard = selectTarget(e, world)
    ai.targetId = guard?.id ?? null
    return guard
  }
  const target = selectTarget(e, world)
  ai.targetId = target?.id ?? null
  return target
}

/** Между размышлениями цель не пересматривается — только проверяется, что она видна. */
function resolveTarget(e: ShipEntity, world: World): ShipEntity | null {
  const id = e.ai?.targetId
  if (id == null) return null
  if (world.player.id === id) return isEngageable(world.player) ? world.player : null
  const target = world.ships.find((s) => s.id === id)
  return target && isEngageable(target) ? target : null
}

function flyPatrol(e: ShipEntity, ai: AIState, time: number): void {
  setMode(ai, 'patrol')
  if (ai.modeTimer > 8 || ai.waypoint.distanceTo(e.state.pos) < 120) {
    ai.modeTimer = 0
    patrolWaypoint(ai, time, ai.waypoint)
  }

  steerToward(e.state, ai.waypoint, 2.2, _steer)
  const c = e.controls
  c.pitch = _steer.pitch
  c.yaw = _steer.yaw
  c.rudder = 0
  c.roll = bankToward(e.state, ai.waypoint)
  c.retro = 0
  c.boost = 1
  c.throttle = 0.35
  c.flightAssist = true
}

/** Навести нос и крен на точку. Общий манёвр захода на причал и ожидания очереди. */
function steerTo(e: ShipEntity, aim: Vector3, c: ShipControls): void {
  steerToward(e.state, aim, 2.2, _steer)
  c.pitch = _steer.pitch
  c.yaw = _steer.yaw
  c.roll = bankToward(e.state, aim)
}

/** Точка перед причальными воротами: заходят и швартуются здесь, а не в центре станции. */
function berthPoint(stationPos: Vector3, radius: number, out: Vector3): Vector3 {
  return out.copy(_gate).multiplyScalar(radius + NPC_DOCK.BERTH_RANGE * 0.5).add(stationPos)
}

/**
 * Стыковка трафика к причалу — ПО ОДНОМУ. Причал держит `world.dockOccupantId`:
 * занявший его заходит и швартуется, остальные ждут на кольце ожидания и займут
 * место, едва оно освободится. Игрока это не касается: он стыкуется своим путём
 * (`docked` замораживает мир). Здесь мир живёт, поэтому «стоянка» — не остановка
 * мира, а корабль, гасящий ход у причала на несколько секунд.
 */
function flyDock(e: ShipEntity, ai: AIState, world: World, dt: number): void {
  const station = findStation(world)
  if (!station) {
    // Стыковаться не к чему (прыгнули в систему без причала) — обычный полёт.
    ai.dock = null
    flyPatrol(e, ai, world.time)
    return
  }

  const c = e.controls
  c.flightAssist = true
  c.boost = 1
  c.rudder = 0

  // Отчалил — уходит прочь как обычный трафик: `home` уже уводит от станции.
  if (ai.dock === 'done') {
    flyPatrol(e, ai, world.time)
    return
  }

  if (ai.dock === 'berthed') {
    e.clearance = true // у причала корабль под защитой станции: его не бьют
    ai.dockTimer -= dt
    steerTo(e, berthPoint(station.pos, station.radius, _dockAim), c)
    c.throttle = 0
    c.retro = e.state.vel.length() > 2 ? 1 : 0 // гасит остаточный ход, держась у ворот
    if (ai.dockTimer <= 0) {
      if (world.dockOccupantId === e.id) world.dockOccupantId = null
      e.clearance = false
      ai.dock = 'done'
      // Уходит наружу от станции — прямо от своего места, чтобы не толкаться у причала.
      _depart.copy(e.state.pos).sub(station.pos)
      if (_depart.lengthSq() < 1) _depart.copy(_gate)
      _depart.normalize()
      ai.home.copy(station.pos).addScaledVector(_depart, station.radius + TRAFFIC.DESTINATION_RANGE)
      ai.waypoint.copy(ai.home)
    }
    return
  }

  // inbound: занять причал, если свободен, иначе — в очередь.
  const mine = world.dockOccupantId === e.id
  if (world.dockOccupantId === null || mine) {
    if (!mine) world.dockOccupantId = e.id
    berthPoint(station.pos, station.radius, _dockAim)
    steerTo(e, _dockAim, c)
    const toBerth = e.state.pos.distanceTo(_dockAim)
    // Ход тем меньше, чем ближе причал: влететь в кольцо на полном — таран.
    c.throttle = toBerth > NPC_DOCK.BRAKE_RANGE ? 0.6 : clamp(toBerth / NPC_DOCK.BRAKE_RANGE, 0.06, 0.6)
    c.retro = 0
    if (toBerth < NPC_DOCK.BERTH_RANGE) {
      e.clearance = true
      if (e.state.vel.length() < NPC_DOCK.BERTH_SPEED) {
        ai.dock = 'berthed'
        ai.dockTimer = NPC_DOCK.DWELL
      }
    }
    return
  }

  // Причал занят — ждём очередь на кольце поодаль, не претендуя на место.
  e.clearance = false
  _dockAim.copy(e.state.pos).sub(station.pos)
  if (_dockAim.lengthSq() < 1) _dockAim.copy(_gate)
  _dockAim.normalize().multiplyScalar(station.radius + NPC_DOCK.QUEUE_RANGE).add(station.pos)
  steerTo(e, _dockAim, c)
  const toHold = e.state.pos.distanceTo(_dockAim)
  c.throttle = toHold > 200 ? 0.4 : 0
  c.retro = toHold < 200 && e.state.vel.length() > 5 ? 1 : 0
}

/** Зовётся только в момент «размышления»: между ними режим держится. */
function decideMode(e: ShipEntity, ai: AIState, target: ShipEntity, distance: number): void {
  if (healthFraction(e) < AI.EVADE_HULL_FRAC && shieldFraction(e) < AI.EVADE_SHIELD_FRAC) {
    // Подбит — рвёт дистанцию, а не гибнет героически.
    setMode(ai, 'evade')
  } else if (ai.mode === 'break') {
    if (ai.modeTimer > AI.BREAK_TIME) setMode(ai, 'pursue')
  } else if (ai.mode === 'evade') {
    if (ai.modeTimer > 5 || shieldFraction(e) > 0.5) setMode(ai, 'pursue')
  } else if (distance < AI.BREAK_OFF) {
    // Слишком близко: проскок неизбежен, надо разводить, иначе таран.
    setMode(ai, 'break')
    breakWaypoint(e.state, target.state.pos, ai, ai.waypoint)
  } else if (distance < AI.ENGAGE) {
    setMode(ai, 'attack')
  } else {
    setMode(ai, 'pursue')
  }

  if (ai.mode === 'evade' && ai.modeTimer > 2.5) {
    ai.modeTimer = 0
    breakWaypoint(e.state, target.state.pos, ai, ai.waypoint)
  }
}

/** Дрожание прицела обновляется медленно: чаще — получится белый шум, а не рука. */
function updateAimJitter(ai: AIState, world: World, distance: number, dt: number): void {
  ai.aimJitterTimer -= dt
  if (ai.aimJitterTimer > 0) return

  ai.aimJitterTimer = AI.AIM_JITTER_INTERVAL
  // И шире промахивается. Оба следствия — от выучки, ни одно не от урона.
  const spread = (AI.FIRE_SPREAD * distance) / ai.skill
  const rng = world.rng
  ai.aimJitter.set(signed(rng), signed(rng), signed(rng)).multiplyScalar(spread * 0.5)
}

/**
 * Открывать ли огонь. Угол меряется до САМОЙ цели, а не до точки упреждения:
 * решение стрелять и направление луча обязаны совпадать.
 */
function decideFire(e: ShipEntity, ai: AIState, target: ShipEntity, distance: number): void {
  if (ai.mode !== 'attack' || !isEngageable(target) || distance > AI.FIRE_RANGE) return

  shipAxes(e.state.quat, _fwd, _right, _up)
  _toTarget.copy(target.state.pos).sub(e.state.pos).normalize()

  const cone = Math.acos(clamp(_fwd.dot(_toTarget), -1, 1))
  // Угловой размер цели падает как 1/d. Стрелять «примерно туда» издали —
  // значит просто греть стволы.
  const angularSize = Math.atan2(target.spec.hull.radius, Math.max(distance, 1))
  ai.wantsFire = cone < Math.min(AI.FIRE_CONE, angularSize * 2.2)
}
