import { Quaternion, Vector3 } from 'three'
import { WARP } from '../../config/ai'
import type { ShipEntity, WarpPortal, WarpFlash, World } from './entities'
import { isClearOfSolids, pickFreeSpawn } from './spawn'

/**
 * Гиперпереходы чужих кораблей.
 *
 * Приход и уход — один портал: кольцо, «дыра», борт вылетает или влетает.
 * Кто решает уйти — дело ИИ; здесь только исполнение.
 */

const _portal = new Vector3()
const _dir = new Vector3()
const _quat = new Quaternion()
const _forward = new Vector3()

function ringRadius(ship: ShipEntity): number {
  return Math.max(ship.spec.hull.radius * WARP.ARRIVAL.RING_SCALE, WARP.ARRIVAL.RING_MIN)
}

function shipForward(ship: ShipEntity, out: Vector3): Vector3 {
  return out.set(0, 0, -1).applyQuaternion(ship.state.quat)
}

/** Смещение борта вдоль нормали портала (+ = за плоскостью по ходу полёта). */
function alongPortal(ship: ShipEntity, portal: WarpPortal): number {
  const dx = ship.state.pos.x - portal.pos.x
  const dy = ship.state.pos.y - portal.pos.y
  const dz = ship.state.pos.z - portal.pos.z
  return dx * portal.dir.x + dy * portal.dir.y + dz * portal.dir.z
}

function pushPortal(world: World, portal: WarpPortal): void {
  world.warpPortals.push(portal)
}

function finishDeparture(world: World, ship: ShipEntity, index: number): void {
  ship.warpDeparting = false
  ship.warpedOut = true
  world.warpPortals.splice(index, 1)
}

/** Оставить вспышку перехода. Только для аварийного мгновенного ухода. */
export function spawnWarpFlash(world: World, pos: Vector3, arriving: boolean): void {
  const flash: WarpFlash = { pos: pos.clone(), born: world.time, arriving }
  world.warps.push(flash)
}

/**
 * Прибытие через портал: свободная точка рядом с `near`, кольцо, борт вылетает
 * вдоль `exitDir` и быстро гасит ход. Вызывать сразу после `spawnOne`.
 */
export function beginWarpArrival(world: World, ship: ShipEntity, near: Vector3, exitDir: Vector3): void {
  // Точку прихода уже выбрал трафик — по кромке дальности локатора, — и она не
  // произвольная: борт обязан появиться там, где его видно. `pickFreeSpawn` же НИКОГДА
  // не отдаёт саму точку (он расселяет новичка вокруг причала, где центр занят) и сразу
  // уходит на 1400–4000 м в случайную сторону, а при тесноте растит кольцо дальше.
  // Ведущего звена такая проверка считала занятым местом из-за СВОИХ ЖЕ ведомых в двухстах
  // метрах — и уносила портал за 11 км при коридоре 6–9. Бережёмся только от твёрдого.
  if (isClearOfSolids(world, near)) _portal.copy(near)
  else pickFreeSpawn(world, near, world.rng, _portal)
  _dir.copy(exitDir)
  if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1)
  _dir.normalize()

  const radius = ringRadius(ship)
  pushPortal(world, {
    shipId: ship.id,
    pos: _portal.clone(),
    dir: _dir.clone(),
    born: world.time,
    ringRadius: radius,
    kind: 'arrive',
  })

  _quat.setFromUnitVectors(new Vector3(0, 0, -1), _dir)
  ship.state.pos.copy(_portal).addScaledVector(_dir, -radius * 0.42)
  ship.state.quat.copy(_quat)
  ship.state.vel.copy(_dir).multiplyScalar(WARP.ARRIVAL.EMERGE_SPEED)
  ship.state.angVel.set(0, 0, 0)
  ship.warpEmerging = true
  ship.warpDeparting = false
  ship.controls.throttle = 0
  ship.controls.retro = 0
  ship.controls.flightAssist = true
}

/**
 * Уход через портал: кольцо раскрывается впереди по носу, борт разгоняется
 * на несколько корпусов и пропадает в «дыре».
 */
export function beginWarpDeparture(world: World, ship: ShipEntity): void {
  shipForward(ship, _forward)
  if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, 1)
  _forward.normalize()

  const radius = ringRadius(ship)
  const ahead = ship.spec.hull.radius * WARP.DEPART.RING_AHEAD
  _portal.copy(ship.state.pos).addScaledVector(_forward, ahead)
  pickFreeSpawn(world, _portal, world.rng, _portal)

  pushPortal(world, {
    shipId: ship.id,
    pos: _portal.clone(),
    dir: _forward.clone(),
    born: world.time,
    ringRadius: radius,
    kind: 'depart',
  })

  ship.warpDeparting = true
  ship.warpEmerging = false
  ship.state.vel.set(0, 0, 0)
  ship.state.angVel.set(0, 0, 0)
  ship.controls.throttle = 0
  ship.controls.retro = 0
  ship.controls.flightAssist = false
  if (ship.ai) {
    ship.ai.wantsFire = false
    ship.ai.wantsMissile = false
    ship.ai.wantsEcm = false
    ship.ai.warpTimer = -1
  }
}

/** Шаг порталов: вылет с торможением или влёт с разгоном и исчезновение. */
export function stepWarpEmergence(world: World, dt: number): void {
  const now = world.time
  for (let i = world.warpPortals.length - 1; i >= 0; i--) {
    const portal = world.warpPortals[i]!
    const age = now - portal.born
    const ship = world.ships.find((s) => s.id === portal.shipId)
    const life = portal.kind === 'arrive' ? WARP.ARRIVAL.LIFE : WARP.DEPART.LIFE

    if (!ship?.alive || age > life) {
      if (ship && portal.kind === 'depart') finishDeparture(world, ship, i)
      else {
        if (ship) {
          ship.warpEmerging = false
          ship.warpDeparting = false
        }
        world.warpPortals.splice(i, 1)
      }
      continue
    }

    if (portal.kind === 'arrive') stepArrive(ship, dt)
    else stepDepart(world, ship, portal, dt, i)
  }
}

function stepArrive(ship: ShipEntity, dt: number): void {
  ship.warpEmerging = true
  ship.warpDeparting = false
  const speed = ship.state.vel.length()
  if (speed > 8) {
    ship.state.vel.multiplyScalar(Math.max(0, 1 - WARP.ARRIVAL.BRAKE * dt))
  } else {
    ship.warpEmerging = false
    ship.state.vel.multiplyScalar(Math.max(0, 1 - dt * 4))
  }
  ship.controls.throttle = 0
  ship.controls.retro = speed > 12 ? 1 : 0
  ship.controls.flightAssist = true
  silenceAi(ship)
}

function stepDepart(world: World, ship: ShipEntity, portal: WarpPortal, dt: number, index: number): void {
  ship.warpDeparting = true
  ship.warpEmerging = false
  silenceAi(ship)

  const rel = alongPortal(ship, portal)
  const speedAlong = ship.state.vel.dot(portal.dir)
  if (speedAlong < WARP.DEPART.MAX_SPEED) {
    ship.state.vel.addScaledVector(portal.dir, WARP.DEPART.ACCEL * dt)
  }

  _quat.setFromUnitVectors(new Vector3(0, 0, -1), portal.dir)
  ship.state.quat.slerp(_quat, Math.min(1, dt * 6))
  ship.controls.throttle = 0
  ship.controls.retro = 0
  ship.controls.flightAssist = false

  if (rel > portal.ringRadius * 0.12) {
    finishDeparture(world, ship, index)
  }
}

function silenceAi(ship: ShipEntity): void {
  if (!ship.ai) return
  ship.ai.wantsFire = false
  ship.ai.wantsMissile = false
  ship.ai.wantsEcm = false
}

/** Мгновенный уход без портала — аварийный fallback. */
export function jumpOut(world: World, ship: ShipEntity): void {
  spawnWarpFlash(world, ship.state.pos, false)
  ship.warpedOut = true
  ship.warpDeparting = false
  ship.warpEmerging = false
  world.warpPortals = world.warpPortals.filter((p) => p.shipId !== ship.id)
}

/** Борт ещё за «дырой» при прибытии — не рисуем. */
export function warpEmergeHidden(world: World, ship: ShipEntity): boolean {
  if (!ship.warpEmerging) return false
  const portal = world.warpPortals.find((p) => p.shipId === ship.id && p.kind === 'arrive')
  if (!portal) return false
  return alongPortal(ship, portal) < portal.ringRadius * 0.08
}

/** Борт уже в «дыре» при уходе — прячем корпус. */
export function warpDepartHidden(world: World, ship: ShipEntity): boolean {
  if (!ship.warpDeparting) return false
  const portal = world.warpPortals.find((p) => p.shipId === ship.id && p.kind === 'depart')
  if (!portal) return false
  return alongPortal(ship, portal) > portal.ringRadius * 0.05
}
