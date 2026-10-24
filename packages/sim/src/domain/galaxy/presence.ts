import { Quaternion, Vector3 } from 'three'
import { ARRIVAL, GALAXY, GALAXY_FLIGHT } from '../../config/galaxy'
import { MIELOPHONE } from '../../config/mielophone'
import {
  catalogLyToWorld,
  effectiveRadius,
  galaxyAnchorLocal,
  locusFollowsZoom,
  metersPerLy,
  playerGalaxyLy,
  preserveGalaxyLocus,
} from '../scale/scale'
import { clearContactLock, clearNavLock, jumpIsRoute } from '../world/queries'
import { enterSystem } from '../world/factory'
import { maybeShiftOrigin } from '../world/origin'
import { isLuminary, luminary } from '../world/orbits'
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

/**
 * Последний полный перебор каталога для мира: где был локус, кто ближайший и запас.
 * Ближайшая не сменится, пока локус ушёл меньше чем на (d₂ − d₁)/2 (неравенство
 * треугольника): ответ тот же, что у полного перебора, — детерминизм цел. Без этого
 * на галактическом × каждый такт перебирались все 10 000 систем.
 */
interface NearestScan {
  seed: number
  x: number
  y: number
  z: number
  best: number
  margin: number
}
const _scans = new WeakMap<World, NearestScan>()

function scanNearest(world: World, ly: { x: number; y: number; z: number }): number {
  const seed = world.galaxySeed
  const c = _scans.get(world)
  if (c && c.seed === seed && Math.hypot(ly.x - c.x, ly.y - c.y, ly.z - c.z) < c.margin) return c.best
  let best = 0
  let bestD = Infinity
  let secondD = Infinity
  for (let i = 0; i < GALAXY.COUNT; i++) {
    const d = distanceLy(ly, placeSystem(i, seed))
    if (d < bestD) {
      secondD = bestD
      bestD = d
      best = i
    } else if (d < secondD) {
      secondD = d
    }
  }
  const scan = c ?? { seed, x: 0, y: 0, z: 0, best: 0, margin: 0 }
  scan.seed = seed
  scan.x = ly.x
  scan.y = ly.y
  scan.z = ly.z
  scan.best = best
  scan.margin = (secondD - bestD) / 2
  if (!c) _scans.set(world, scan)
  return best
}

/** Ближайшая система к локусу. С гистерезисом — не прыгаем на равной границе. */
export function nearestSystemIndex(
  world: World,
  ly: { x: number; y: number; z: number },
  hysteresis: boolean,
): number {
  const seed = world.galaxySeed
  const best = scanNearest(world, ly)
  const bestD = distanceLy(ly, placeSystem(best, seed))
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

/**
 * Точка на луче звезда→пилот на `maxLy` от звезды. Иначе усадка в 1 св.г. от
 * цели ставила борт в системные метры гигантского кадра — дыра «в 1000 км»
 * не приближалась, сопла дрожали (float32).
 */
function pullIntoBubble(
  playerLy: { x: number; y: number; z: number },
  star: { x: number; y: number; z: number },
  maxLy: number,
): { x: number; y: number; z: number } {
  const d = distanceLy(playerLy, star)
  if (d <= maxLy || d < 1e-12) return playerLy
  const t = maxLy / d
  return {
    x: star.x + (playerLy.x - star.x) * t,
    y: star.y + (playerLy.y - star.y) * t,
    z: star.z + (playerLy.z - star.z) * t,
  }
}

/**
 * 0.02 св.г на галактическом × — меньше истинного радиуса гиганта (и часто карлика
 * после перевода в метры GHOST). Выше порога твердь сквозная; усадка её включает,
 * борт оказывается внутри, отскок — на корпус (~60 км при ×5к). Всегда снаружи.
 */
function standOffFromStar(world: World): void {
  const player = world.player
  const live = luminary(world.bodies, 0)
  if (!live) return
  const minDist = live.radius + effectiveRadius(player) + ARRIVAL.STANDOFF
  _start.copy(player.state.pos).sub(live.pos)
  if (_start.lengthSq() < 1e-8) _start.set(1, 0, 0)
  if (_start.length() >= minDist) return
  _start.setLength(minDist)
  player.state.pos.copy(live.pos).add(_start)
  maybeShiftOrigin(world)
}

/**
 * Борт в точку `ly` кадра: от барицентра системы кадра, в метрах роста `scale` — того, при
 * котором `ly` померен. Иная мера сдвигала локус в S/GHOST раз: на ×500 прибытие ставило
 * борт к звезде вдесятеро ближе, чем он к ней подлетел.
 */
function placeAtLocus(world: World, ly: { x: number; y: number; z: number }, scale: number): void {
  const origin = placeSystem(world.galaxyFrameIndex, world.galaxySeed)
  catalogLyToWorld(ly.x - origin.x, ly.y - origin.y, ly.z - origin.z, metersPerLy(scale), _start)
  galaxyAnchorLocal(world, world.player.state.pos).add(_start)
  maybeShiftOrigin(world)
}

/** `lyScale` — рост, при котором померен `playerLy` (мера постановки), `scale` — новый рост. */
function arriveAt(
  world: World,
  index: number,
  playerLy: { x: number; y: number; z: number },
  lyScale: number,
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
  // Мера — та же, что у `placeAtLocus`: локус после прибытия равен локусу до него.
  catalogLyToWorld(playerLy.x - star.x, playerLy.y - star.y, playerLy.z - star.z, metersPerLy(lyScale), _start)
  const def = systemDefFor(index, world.galaxySeed)
  syncLiveContactsFromShips(world)
  enterSystem(world, def, index, def.playerStart, stellarOnly)
  carryFollowersOnJump(world)
  driftContacts(world)
  if (!stellarOnly) spawnResidentContacts(world)

  // От барицентра — того же якоря, от которого меряется локус (`galaxyAnchorLocal`):
  // иначе у двойной локус сразу после прибытия расходился с `ly` на разнос пары.
  galaxyAnchorLocal(world, player.state.pos).add(_start)
  maybeShiftOrigin(world)
  standOffFromStar(world)
  player.state.scale = scale
  // В пустоте зум ведёт локус: из меры постановки — в метры нового роста.
  if (stellarOnly) preserveGalaxyLocus(player, world, lyScale, scale)
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
  world.bodies = world.bodies.filter(isLuminary)
  world.systemStellarOnly = true
  // Трафик в пустоте остаётся: кинематика причала (Слово в Крестах) — нет, станции уже нет.
  world.ships = world.ships.filter((s) => !s.kinematic)
  for (const s of world.ships) {
    if (!s.ai) continue
    if (s.ai.dock === 'inbound' || s.ai.dock === 'berthed') {
      s.ai.dock = 'done'
      s.clearance = false
    }
  }
  world.berths.clear()
  world.asteroids = []
  world.asteroidBelts = []
  world.pulses = []
  world.titans = []
  world.platforms = []
  world.monoliths = []
  world.figurines = []
  world.warBases = []
  world.warShards = []
  world.firePuffs = []
  world.dyson = null
  if (world.contactLock?.kind !== 'ship') world.contactLock = null
  // Маршрут на другую звезду уже цель: не вешать нав на оставшуюся свою —
  // HUD рисовал две стрелки (264 св.с своей и св.г. выбранной).
  world.navTargetId = jumpIsRoute(world) ? null : world.bodies[0]?.id ?? null
  world.epoch += 1
}

/**
 * Шаг после `stepScale` игрока. Старый масштаб — чтобы поймать пересечение GHOST_BODY:
 * там локус ещё в метрах крупного ×, и без ремапа к порогу усадка вернула бы домой.
 */
export function stepGalaxyPresence(world: World, oldScale: number): void {
  // Кресты — вне галактик: ближайшей звезды у комнаты нет, пересобирать её некуда.
  if (world.docked || world.player.landedOn || world.inMonument) return
  const player = world.player
  const newScale = player.state.scale
  const ghost = MIELOPHONE.GHOST_BODY_SCALE

  if (oldScale < ghost && newScale >= ghost) {
    // Система растворилась: планета/станция/борт больше не цель. Звезда с карты — маршрут.
    clearNavLock(world)
    clearContactLock(world)
    world.galaxyFrameIndex = world.systemIndex
  }

  const crossingDown = oldScale >= ghost && newScale < ghost
  // В пустоте `stepScale` уже перевёл локус в метры нового роста (`locusFollowsZoom`). В
  // собранной системе — нет: довести его до порога, ниже метры уже системные.
  const zoomed = locusFollowsZoom(world, oldScale, newScale)
  if (crossingDown && !zoomed) preserveGalaxyLocus(player, world, oldScale, ghost)
  const lyScale = crossingDown && !zoomed ? ghost : newScale
  let ly = playerGalaxyLy(world, lyScale)
  // «Пузырь загружен» — по флагу входа, не по наличию планет: у Ядра их нет,
  // и пустая система иначе пересобиралась каждый такт.
  const populated = !world.systemStellarOnly
  // В своём пузыре ближайшая не меняется — не сканируем каталог каждый такт.
  // Усадка через GHOST сюда не входит: ly ещё галактические, 0.02 св.г. часто
  // внутри звезды, и без пересчёта борт влипает в твердь.
  if (
    !crossingDown
    && newScale < ghost
    && populated
    && world.galaxyFrameIndex === world.systemIndex
  ) {
    const here = distanceLy(ly, placeSystem(world.systemIndex, world.galaxySeed))
    if (here < GALAXY_FLIGHT.BUBBLE_LY) return
  }
  let nearest = nearestSystemIndex(world, ly, newScale >= ghost)
  let dist = distanceLy(ly, placeSystem(nearest, world.galaxySeed))
  let pulled = false

  // Усадка из галактики. Кадр в полёте не пересобираем (enterSystem каждый
  // Voronoi — дёрганье). Куда садимся: ближайшая, если явно ближе кадра
  // (долетели); иначе кадр (выросли и сразу сжались — AU не считаем св.г.).
  if (crossingDown) {
    const frame = world.galaxyFrameIndex
    const dFrame = distanceLy(ly, placeSystem(frame, world.galaxySeed))
    if (dist + GALAXY_FLIGHT.CURRENT_HYSTERESIS_LY >= dFrame) {
      nearest = frame
      dist = dFrame
    }
    if (dist > GALAXY_FLIGHT.BUBBLE_LY) {
      const star = placeSystem(nearest, world.galaxySeed)
      ly = pullIntoBubble(ly, star, GALAXY_FLIGHT.BUBBLE_LY * 0.8)
      dist = distanceLy(ly, star)
      pulled = true
    }
  }

  const bodies = wantBodies(dist, populated && world.galaxyFrameIndex === nearest)

  adoptCurrent(world, nearest)

  if (crossingDown) {
    if (world.galaxyFrameIndex === nearest) {
      // Свой кадр: локус уже в метрах кадра (preserveGalaxyLocus). Подтянутую к
      // пузырю точку ПРИМЕНЯЕМ — иначе борт оставался за пузырём (в 1 св.г.·GHOST),
      // система снималась тактом позже и собиралась снова при дальнейшей усадке.
      if (pulled) placeAtLocus(world, ly, lyScale)
      if (bodies && !populated) arriveAt(world, nearest, ly, lyScale, newScale, false)
      else standOffFromStar(world)
      return
    }
    arriveAt(world, nearest, ly, lyScale, newScale, !bodies)
    return
  }

  if (newScale >= ghost) return

  const loaded = world.galaxyFrameIndex
  if (bodies) {
    if (loaded !== nearest || !populated) arriveAt(world, nearest, ly, lyScale, newScale, false)
    return
  }
  if (populated && loaded === nearest) {
    stripToStar(world)
    return
  }
  if (oldScale >= ghost) {
    // Усадка в пустоте: нужна хотя бы звезда ближайшей, иначе кадр остаётся у дома.
    arriveAt(world, nearest, ly, lyScale, newScale, true)
  }
}
