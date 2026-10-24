import { Vector3 } from 'three'
import { copilotGoto, copilotSteer, disengageAutofight, findNavByName, jumpBlock, undock, type Controller, type ShipEntity, type World } from '@elite/sim'
import { closePortal, jumpPortal, openPortal } from './jumpPortal'
import { startUndock } from './undockFx'
import { pushWarning } from './warnings'

/**
 * РЕЙС ВТОРОГО ПИЛОТА в другую систему: «летим туда» — и он ведёт сам, по шагам пилота-человека.
 *
 *  1. ОТЧАЛИТЬ, если стоим у причала;
 *  2. ОТОЙТИ от станции — кольцо у самого дока раскрывать нельзя;
 *  3. ВСТАТЬ — кольцо ставится перед носом и не догоняет летящего;
 *  4. РАСКРЫТЬ кольцо — держит «H» за пилота, пока оно не раскроется целиком;
 *  5. ВОЙТИ — немного газа через центр кольца, переход меняет мир;
 *  6. там — КУРС на цель (по имени: планета, станция, статуя, база; нет — к причалу).
 *
 * Живёт в сессии, а не в домене: кольцо прыжка — состояние сессии (`jumpPortal`). Домен лишь
 * оставляет просьбу (`world.tripRequest`) и даёт ручку «веди задачей» (`copilotSteer`). Отмена —
 * в любой миг: J, приказ «стоп», закрытое кольцо, гибель.
 */

type Phase = 'undock' | 'clear' | 'stop' | 'open' | 'enter' | 'arrive'

interface Trip {
  system: number
  target: string | null
  /** Планета с причалом для выхода (выбор на карте); null — у столицы. */
  arrivalPlanet: number | null
  phase: Phase
  /** Мировое время входа в фазу, с. */
  since: number
  /** Задача фазы уже отдана пилоту. */
  steered: boolean
}

/** На сколько отойти от кромки станции, м, прежде чем вставать под кольцо. */
const CLEAR_DISTANCE = 4_000
/** Встали — ход ниже этого, м/с. */
const STOP_SPEED = 30
/** Минимум стоять перед раскрытием, с: чтобы погас разворот и кольцо встало ровно по носу. */
const STOP_MIN = 1.5
/** Кольцо раскрыто — доля предельного радиуса. */
const RING_OPEN = 0.98
/**
 * Газ на входе в кольцо, доля. Немного: кольцо стоит прямо по носу, разгоняться незачем, а
 * на малом ходу лётный компьютер держит курс по оси без сноса.
 */
const ENTER_THROTTLE = 0.25
/** Пролёт сквозь кольцо дольше этого — что-то пошло не так, рейс снимаем. */
const ENTER_TIMEOUT = 40

let trip: Trip | null = null
const _dir = new Vector3()
const _point = new Vector3()

/** Идёт ли рейс (J отменяет его, как и прочий автопилот второго пилота). */
export function tripActive(): boolean {
  return trip !== null
}

/**
 * С раскрытия кольца корабль ведёт не ИИ, а ПРЯМОЙ штурвал: рули на нуле, чуть газа. Кольцо
 * ставится ровно по носу, и пилот-человек просто даёт газ. ИИ же, держа позицию, поворачивал
 * нос, а на подлёте закладывал вираж — и проходил мимо отверстия (замер: снос до 110 м при
 * радиусе кольца 73 м).
 */
export function tripSteersStraight(): boolean {
  return trip?.phase === 'open' || trip?.phase === 'enter'
}

export const tripController: Controller = {
  update(ship: ShipEntity): void {
    const c = ship.controls
    c.pitch = 0
    c.yaw = 0
    c.roll = 0
    c.rudder = 0
    c.strafe = 0
    c.strafeUp = 0
    c.boost = 1
    c.retro = 0
    c.grow = 0
    c.flightAssist = true
    c.throttle = trip?.phase === 'enter' ? ENTER_THROTTLE : 0
  },
  wantsFire(): boolean {
    return false
  },
}

/** Держит ли пилот «H» прямо сейчас: кольцо растёт, пока он держит. */
export function tripGrowHeld(): boolean {
  return trip?.phase === 'open'
}

function enter(world: World, phase: Phase): void {
  if (trip) {
    trip.phase = phase
    trip.since = world.time
    trip.steered = false
  }
}

/**
 * Снять рейс. Кольцо, раскрытое им, закрываем (если переход ещё не начался), штурвал отдаём.
 * Возвращает true, если кольцо закрыто здесь — дальний мир тогда выбрасывает вызывающий (рендер).
 */
export function cancelTrip(world: World, quiet = false): boolean {
  if (!trip) return false
  const ownRing = trip.phase === 'open' || trip.phase === 'enter'
  trip = null
  disengageAutofight(world)
  if (!quiet) pushWarning('tripCancelled', world.time, { repeat: 0 })
  const p = jumpPortal()
  if (ownRing && p.open && !p.committing) {
    closePortal()
    return true
  }
  return false
}

/** Id ближайшей станции. */
function nearestStationId(world: World): number | null {
  let best: number | null = null
  let bestD = Infinity
  for (const b of world.bodies) {
    if (b.kind !== 'station') continue
    const d = b.pos.distanceToSquared(world.player.state.pos)
    if (d < bestD) {
      bestD = d
      best = b.id
    }
  }
  return best
}

/** Ближайшая станция и расстояние до её кромки, м. */
function nearestStation(world: World): { pos: Vector3; radius: number; gap: number } | null {
  let best: { pos: Vector3; radius: number; gap: number } | null = null
  for (const b of world.bodies) {
    if (b.kind !== 'station') continue
    const gap = b.pos.distanceTo(world.player.state.pos) - b.radius
    if (!best || gap < best.gap) best = { pos: b.pos, radius: b.radius, gap }
  }
  return best
}

/**
 * Такт режиссёра. Зовёт кадр симуляции (и у причала — чтобы отчалить). Возвращает true, если
 * здесь закрыто кольцо: дальний мир выбрасывает рендер (`disposeJumpPortalWorld`).
 */
export function stepCopilotTrip(world: World): boolean {
  const req = world.tripRequest
  if (req) {
    world.tripRequest = null
    if (req === 'cancel') return cancelTrip(world)
    const closed = trip ? cancelTrip(world, true) : false
    trip = { system: req.system, target: req.target, arrivalPlanet: req.arrivalPlanet ?? null, phase: 'undock', since: world.time, steered: false }
    pushWarning('tripStart', world.time, { repeat: 0 })
    if (closed) return true
  }
  if (!trip) return false
  if (!world.copilot || !world.player.alive) return cancelTrip(world)

  const p = jumpPortal()
  switch (trip.phase) {
    case 'undock': {
      if (world.docked) {
        undock(world)
        startUndock()
      }
      enter(world, 'clear')
      return false
    }
    case 'clear': {
      const station = nearestStation(world)
      if (!station || station.gap >= CLEAR_DISTANCE) {
        enter(world, 'stop')
        return false
      }
      // Задачу ставим один раз за фазу: точка — наружу от станции, за кромкой на CLEAR.
      // Пилот отдал штурвал (задача исполнена, а станция уехала по орбите) — ведём снова.
      if (!trip.steered || !world.player.ai) {
        trip.steered = true
        _dir.copy(world.player.state.pos).sub(station.pos)
        if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1)
        _point.copy(station.pos).addScaledVector(_dir.normalize(), station.radius + CLEAR_DISTANCE * 1.2)
        copilotSteer(world, { kind: 'goto', point: _point.clone(), arriveRadius: 300 })
      }
      return false
    }
    case 'stop': {
      // Рейс по своей же системе (приказ дан у причала): кольцо не нужно — сразу курс на цель.
      if (trip.system === world.systemIndex) {
        enter(world, 'arrive')
        return false
      }
      if (!trip.steered || !world.player.ai) {
        trip.steered = true
        copilotSteer(world, { kind: 'hold', anchor: world.player.state.pos.clone(), radius: 100 })
      }
      if (world.player.state.vel.length() < STOP_SPEED && world.time - trip.since >= STOP_MIN) {
        const blocked = jumpBlock(world, trip.system)
        if (blocked !== null) {
          pushWarning('noJump', world.time, { repeat: 0 })
          return cancelTrip(world, true)
        }
        world.jumpTargetIndex = trip.system
        // Дальше ведёт прямой штурвал (`tripController`): ИИ поворачивал бы нос.
        disengageAutofight(world)
        openPortal(world, trip.system, trip.arrivalPlanet != null ? { kind: 'body', planet: trip.arrivalPlanet } : null, world.time)
        enter(world, 'open')
      }
      return false
    }
    case 'open': {
      if (!p.open) return cancelTrip(world)
      if (p.destWarm && p.ringRadius >= p.targetRadius * RING_OPEN) enter(world, 'enter')
      return false
    }
    case 'enter': {
      if (world.systemIndex === trip.system) {
        enter(world, 'arrive')
        return false
      }
      if (!p.open && !p.committing) return cancelTrip(world)
      if (world.time - trip.since > ENTER_TIMEOUT) return cancelTrip(world)
      return false
    }
    case 'arrive': {
      if (world.docked) return false
      const target = trip.target
      trip = null
      disengageAutofight(world)
      // Без названной цели — к ближайшему причалу: выход из кольца кладёт рядом с выбранным.
      const id = target ? findNavByName(world, target) : (nearestStationId(world) ?? null)
      if (id !== null && copilotGoto(world, id) === 'ok') pushWarning('tripArrived', world.time, { repeat: 0 })
      else pushWarning('noTarget', world.time, { repeat: 0 })
      return false
    }
  }
}
