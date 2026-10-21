import { Quaternion, Vector3 } from 'three'
import { GALAXY, GALAXY_FLIGHT } from '../../config/galaxy'
import { MIELOPHONE } from '../../config/mielophone'
import {
  catalogLyToWorld,
  metersPerLy,
  playerGalaxyLy,
  preserveGalaxyLocus,
} from '../scale/scale'
import { clearContactLock, clearNavLock, systemPopulated } from '../world/queries'
import { enterSystem } from '../world/factory'
import { spawnResidentContacts } from '../world/traffic'
import { carryFollowersOnJump, syncLiveContactsFromShips } from '../world/plan'
import type { World } from '../world/entities'
import { generateSystem } from './generate'
import { systemDefFor } from './jump'
import { driftContacts } from './contacts'
import { distanceLy, placeSystem } from './shape'

/**
 * Связное пространство: текущая система — ближайшая звезда; её планеты живут
 * только внутри BUBBLE_LY. Выше GHOST_BODY мир не пересобираем (тела и так
 * сквозные) — только имя/индекс. Ниже порога вход в пузырь рисует систему,
 * выход оставляет звезду. Выбранная на карте цель (`jumpTarget`) не сбрасывается,
 * пока борт не войдёт в её пузырь.
 */

const _quat = new Quaternion()
const _vel = new Vector3()
const _ang = new Vector3()
const _start = new Vector3()

function wantBodies(distLy: number, populated: boolean): boolean {
  // Гистерезис на кромке: иначе на BUBBLE_LY каждый такт собирали/снимали систему.
  const enter = GALAXY_FLIGHT.BUBBLE_LY
  const leave = enter * 1.2
  return populated ? distLy < leave : distLy < enter
}

/** Ближайшая система к локусу. С гистерезисом — не прыгаем на равной границе. */
export function nearestSystemIndex(
  world: World,
  ly: { x: number; y: number; z: number },
  hysteresis: boolean,
): number {
  const seed = world.galaxySeed
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < GALAXY.COUNT; i++) {
    const d = distanceLy(ly, placeSystem(i, seed))
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  if (hysteresis) {
    const cur = world.systemIndex
    if (cur >= 0 && cur < GALAXY.COUNT) {
      const dCur = distanceLy(ly, placeSystem(cur, seed))
      if (dCur <= bestD + GALAXY_FLIGHT.CURRENT_HYSTERESIS_LY) return cur
    }
  }
  return best
}

function adoptCurrent(world: World, index: number): void {
  if (world.systemIndex === index) return
  world.systemIndex = index
  world.systemName = generateSystem(index, world.galaxySeed).name
}

function arriveAt(
  world: World,
  index: number,
  playerLy: { x: number; y: number; z: number },
  scale: number,
  stellarOnly: boolean,
): void {
  const player = world.player
  _quat.copy(player.state.quat)
  _vel.copy(player.state.vel)
  _ang.copy(player.state.angVel)
  const throttle = player.controls.throttle
  const grow = player.controls.grow
  const jumpTarget = world.jumpTargetIndex
  const star = placeSystem(index, world.galaxySeed)
  catalogLyToWorld(
    playerLy.x - star.x,
    playerLy.y - star.y,
    playerLy.z - star.z,
    metersPerLy(scale),
    _start,
  )
  const def = systemDefFor(index, world.galaxySeed)
  const start: [number, number, number] = [
    def.star.pos[0] + _start.x,
    def.star.pos[1] + _start.y,
    def.star.pos[2] + _start.z,
  ]
  syncLiveContactsFromShips(world)
  enterSystem(world, def, index, start, stellarOnly)
  carryFollowersOnJump(world)
  driftContacts(world)
  if (!stellarOnly) spawnResidentContacts(world)

  player.state.scale = scale
  player.state.quat.copy(_quat)
  player.state.vel.copy(_vel)
  player.state.angVel.copy(_ang)
  player.controls.throttle = throttle
  player.controls.grow = grow
  // Цель с карты — маршрут. Гасим, только войдя в её пузырь (прилетели).
  // Попутная система по пути её не съедает.
  const arrived = !stellarOnly && jumpTarget === index
  world.jumpTargetIndex = arrived ? null : jumpTarget
  world.navTargetId = null
  world.contactLock = null
}

function stripToStar(world: World): void {
  world.bodies = world.bodies.filter((b) => b.kind === 'star' || b.kind === 'blackhole')
  // Трафик в пустоте остаётся: кинематика причала (Слово в Крестах) — нет, станции уже нет.
  world.ships = world.ships.filter((s) => !s.kinematic)
  for (const s of world.ships) {
    if (!s.ai) continue
    if (s.ai.dock === 'inbound' || s.ai.dock === 'berthed') {
      s.ai.dock = 'done'
      s.clearance = false
    }
  }
  world.dockOccupantId = null
  world.asteroids = []
  world.asteroidBelt = undefined
  world.titans = []
  world.platforms = []
  world.monoliths = []
  world.figurines = []
  world.warBases = []
  world.dyson = null
  if (world.contactLock?.kind !== 'ship') world.contactLock = null
  world.navTargetId = world.bodies[0]?.id ?? null
  world.epoch += 1
}

/**
 * Шаг после `stepScale` игрока. Старый масштаб — чтобы поймать пересечение GHOST_BODY:
 * там локус ещё в метрах крупного ×, и без ремапа к порогу усадка вернула бы домой.
 */
export function stepGalaxyPresence(world: World, oldScale: number): void {
  if (world.docked || world.player.landedOn) return
  const player = world.player
  const newScale = player.state.scale
  const ghost = MIELOPHONE.GHOST_BODY_SCALE

  if (oldScale < ghost && newScale >= ghost) {
    // Система растворилась: планета/станция/борт больше не цель. Звезда с карты — маршрут.
    clearNavLock(world)
    clearContactLock(world)
    world.galaxyFrameIndex = world.systemIndex
  }

  if (oldScale >= ghost && newScale < ghost) {
    // Пересекли порог вниз: сначала сохранить ly в метрах GHOST, потом решать систему.
    preserveGalaxyLocus(player, world, oldScale, ghost)
  }

  const lyScale = newScale >= ghost ? newScale : oldScale >= ghost ? ghost : newScale
  const ly = playerGalaxyLy(world, lyScale)
  const populated = systemPopulated(world)
  // В своём пузыре ближайшая не меняется — не сканируем каталог каждый такт.
  if (newScale < ghost && populated && world.galaxyFrameIndex === world.systemIndex) {
    const here = distanceLy(ly, placeSystem(world.systemIndex, world.galaxySeed))
    if (here < GALAXY_FLIGHT.BUBBLE_LY) return
  }
  const nearest = nearestSystemIndex(world, ly, newScale >= ghost)
  const dist = distanceLy(ly, placeSystem(nearest, world.galaxySeed))
  const bodies = wantBodies(dist, populated && world.galaxyFrameIndex === nearest)

  adoptCurrent(world, nearest)

  if (newScale >= ghost) return

  const loaded = world.galaxyFrameIndex
  if (bodies) {
    if (loaded !== nearest || !populated) arriveAt(world, nearest, ly, newScale, false)
    return
  }
  if (populated && loaded === nearest) {
    stripToStar(world)
    return
  }
  if (oldScale >= ghost && loaded !== nearest) {
    // Усадка в пустоте: нужна хотя бы звезда ближайшей, иначе кадр остаётся у дома.
    arriveAt(world, nearest, ly, newScale, true)
  }
}
