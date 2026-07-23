import { Vector3 } from 'three'
import { FIGURINE, FIGURINE_TITLES } from '../../config/figurines'
import { MONOLITH } from '../../config/monoliths'
import { makeRng, range, type Rng } from '../../core/math'
import { addFigurineSpecimens, type CargoHold } from '../cargo/hold'
import { COMMODITIES, figurineTitleName, type FigurineSpecimen } from '../cargo/items'
import { forward } from '../flight/axes'
import { effectiveRadius } from '../scale/scale'
import type { FigurineEntity, ShipEntity, World } from './entities'

/** Итог выкладки из трюма по носу: пересечение режем молча, тесный зазор — «нет места». */
export type PlaceFigurineAheadResult = 'ok' | 'no-room' | 'blocked'

/**
 * Коллекционные статуэтки в системе.
 *
 * Расстановка от сида системы (не `world.rng`): у всех игроков одни и те же места,
 * поток трафика не сдвигаем. Орбитальный радиус — в щелях между путями планет
 * (или за внешней), плюс наклон с эклиптики. Кувырок — `spin·time` в рендере.
 */

const _nose = new Vector3()
const _to = new Vector3()
const _deploy = new Vector3()

/** Имя для нав/карты, если titleId потерян. */
export const FIGURINE_NAME = 'Статуэтка'

/** Случайный экземпляр: имя + облик + габарит. */
export function rollFigurineSpecimen(rng: Rng): FigurineSpecimen {
  const title = FIGURINE_TITLES[Math.floor(rng() * FIGURINE_TITLES.length)]!
  return {
    titleId: title.id,
    variant: Math.floor(rng() * Math.min(FIGURINE.VARIANTS, MONOLITH.VARIANTS)),
    radius: range(rng, FIGURINE.RADIUS_MIN, FIGURINE.RADIUS_MAX),
  }
}

/** Имя мировой статуэтки для локатора/карты. */
export function figurineDisplayName(figurine: FigurineEntity): string {
  return figurineTitleName(figurine.titleId)
}

/** Борт дорос до размера статуэтки и ещё не вырос в SCOOP_MAX_SCALE раз. */
export function canAttractFigurine(ship: ShipEntity, figurine: FigurineEntity): boolean {
  if (!figurine.alive || !ship.alive) return false
  const er = effectiveRadius(ship)
  return (
    er >= figurine.radius * FIGURINE.SCOOP_MIN_SCALE &&
    er < figurine.radius * FIGURINE.SCOOP_MAX_SCALE
  )
}

/** Орбитальные радиусы планет (горизонталь от звезды). */
function planetOrbitRadii(world: World, starPos: Vector3): number[] {
  const radii: number[] = []
  for (const body of world.bodies) {
    if (body.kind !== 'planet') continue
    const r = Math.hypot(body.pos.x - starPos.x, body.pos.z - starPos.z)
    if (r > 1) radii.push(r)
  }
  radii.sort((a, b) => a - b)
  return radii
}

/**
 * Кандидаты орбитального радиуса: середины щелей между планетами и кольцо
 * за самой внешней. Ширина щели должна вместить статуэтку с зазором.
 */
function orbitCandidates(planetOrbits: number[], statueR: number, starR: number): number[] {
  const clear = statueR * FIGURINE.ORBIT_CLEARANCE
  const minGap = statueR * FIGURINE.GAP_MIN_SCALE
  const out: number[] = []

  const innerFloor = Math.max(starR * 8, statueR * 6)
  if (planetOrbits.length === 0) {
    out.push(innerFloor + statueR * 20)
    out.push(innerFloor + statueR * 60)
    return out
  }

  const first = planetOrbits[0]!
  if (first - innerFloor > minGap) {
    out.push((innerFloor + first) * 0.5)
  }

  for (let i = 0; i < planetOrbits.length - 1; i++) {
    const a = planetOrbits[i]!
    const b = planetOrbits[i + 1]!
    if (b - a > minGap + 2 * clear) {
      out.push((a + b) * 0.5)
    }
  }

  const outer = planetOrbits[planetOrbits.length - 1]!
  out.push(outer + clear + statueR * FIGURINE.GAP_MIN_SCALE)

  return out
}

function farFromBodies(world: World, pos: Vector3, statueR: number): boolean {
  return probeClearance(world, pos, statueR) === 'ok'
}

/**
 * Место под статуэтку: жёсткое пересечение объёмов → `blocked`,
 * орбита у звезды слишком низкая или тело в зоне зазора → `no-room`.
 * Свой борт не проверяем: центр в 3–5 км по носу при радиусе десятки км
 * почти всегда накрывает корабль — это норма выкладки, не ошибка.
 */
function probeClearance(world: World, pos: Vector3, statueR: number): PlaceFigurineAheadResult {
  const soft = statueR * FIGURINE.ORBIT_CLEARANCE

  for (const body of world.bodies) {
    const d = pos.distanceTo(body.pos)
    if (body.kind === 'star' || body.kind === 'blackhole') {
      if (d < body.radius + statueR) return 'blocked'
      // Та же «внутренняя» орбита, что при авторасстановке системы.
      const minOrbit = Math.max(body.radius * 8, statueR * 6)
      if (d < minOrbit) return 'no-room'
      continue
    }
    if (d < body.radius + statueR) return 'blocked'
    if (d < body.radius + soft) return 'no-room'
  }

  for (const m of world.monoliths) {
    const d = pos.distanceTo(m.pos)
    if (d < m.radius + statueR) return 'blocked'
    if (d < m.radius + soft) return 'no-room'
  }

  for (const f of world.figurines) {
    if (!f.alive) continue
    const d = pos.distanceTo(f.pos)
    if (d < f.radius + statueR) return 'blocked'
    if (d < f.radius + statueR + soft) return 'no-room'
  }

  for (const a of world.asteroids) {
    if (!a.alive) continue
    const d = pos.distanceTo(a.pos)
    if (d < a.radius + statueR) return 'blocked'
    if (d < a.radius + soft) return 'no-room'
  }

  for (const r of world.warBases) {
    if (!r.alive) continue
    const d = pos.distanceTo(r.pos)
    if (d < r.radius + statueR) return 'blocked'
    if (d < r.radius + soft) return 'no-room'
  }

  return 'ok'
}

function placeOne(world: World, rng: Rng, starPos: Vector3, orbits: number[]): boolean {
  const specimen = rollFigurineSpecimen(rng)
  const star = world.bodies.find((b) => b.kind === 'star')
  const starR = star?.radius ?? 1e8
  const candidates = orbitCandidates(orbits, specimen.radius, starR)
  if (candidates.length === 0) return false

  for (let attempt = 0; attempt < 24; attempt++) {
    const orbitR = candidates[Math.floor(rng() * candidates.length)]!
    const az = rng() * Math.PI * 2
    const inc = (rng() - 0.5) * 2 * FIGURINE.INCLINATION_MAX
    const cosI = Math.cos(inc)
    const pos = new Vector3(
      starPos.x + Math.cos(az) * orbitR * cosI,
      starPos.y + Math.sin(inc) * orbitR,
      starPos.z + Math.sin(az) * orbitR * cosI,
    )
    if (!farFromBodies(world, pos, specimen.radius)) continue

    const spinAxis = new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5)
    if (spinAxis.lengthSq() < 1e-6) spinAxis.set(0, 1, 0)
    spinAxis.normalize()

    world.figurines.push({
      id: world.ids.next(),
      kind: 'figurine',
      titleId: specimen.titleId,
      variant: specimen.variant,
      pos,
      spinAxis,
      spin: FIGURINE.SPIN * (0.7 + rng() * 0.6),
      radius: specimen.radius,
      alive: true,
    })
    return true
  }
  return false
}

/** Расставить 1–2 статуэтки в щелях орбит. Зовут после `placeMonoliths` / орбит. */
export function placeFigurines(world: World): void {
  world.figurines = []
  const star = world.bodies.find((b) => b.kind === 'star')
  if (!star) return

  const rng = makeRng((world.systemIndex ^ 0x46494755) >>> 0)
  const orbits = planetOrbitRadii(world, star.pos)
  const count =
    FIGURINE.COUNT_MIN + Math.floor(rng() * (FIGURINE.COUNT_MAX - FIGURINE.COUNT_MIN + 1))

  for (let i = 0; i < count; i++) {
    if (!placeOne(world, rng, star.pos, orbits)) break
  }
}

/** Тяговый луч по статуэтке в окне размера. Дальность — от масштаба борта. */
export function tractorFigurines(world: World, ship: ShipEntity, dt: number): void {
  if (!ship.alive) return
  forward(ship.state.quat, _nose)
  const reach = effectiveRadius(ship) * FIGURINE.TRACTOR_RANGE_SCALE

  for (const fig of world.figurines) {
    if (!canAttractFigurine(ship, fig)) continue

    _to.copy(fig.pos).sub(ship.state.pos)
    const distance = _to.length()
    if (distance > reach || distance < 1e-3) continue

    _to.divideScalar(distance)
    if (_to.dot(_nose) < 0.2) continue

    // Тянем к борту; шаг ограничен размером — без телепорта за кадр.
    const step = Math.min(distance * 0.35, effectiveRadius(ship) * 2) * dt * 8
    fig.pos.addScaledVector(_to, -step)
  }
}

/**
 * Забрать статуэтку в трюм (масса 0), если в окне размера и достаточно близко.
 * `refreshSpec` не нужен: масса груза не меняется.
 */
export function tryScoopFigurine(ship: ShipEntity, figurine: FigurineEntity): boolean {
  if (!canAttractFigurine(ship, figurine)) return false
  const er = effectiveRadius(ship)
  if (figurine.pos.distanceTo(ship.state.pos) > er * FIGURINE.SCOOP_TOUCH) return false

  addFigurineSpecimens(ship.hold, [
    { titleId: figurine.titleId, variant: figurine.variant, radius: figurine.radius },
  ])
  figurine.alive = false
  return true
}

export function scoopFigurinesNear(world: World, ship: ShipEntity): void {
  for (const fig of world.figurines) {
    if (!fig.alive) continue
    tryScoopFigurine(ship, fig)
  }
}

/**
 * Выложить одну статуэтку из трюма в 3–5 км по носу.
 * `null` — не статуэтка / нет предмета / стыковка. Пересечение — `blocked` (молча);
 * тесный зазор или низкая орбита — `no-room` (HUD скажет жёлтым).
 */
export function placeFigurineFromHold(
  world: World,
  ship: ShipEntity,
  index: number,
): PlaceFigurineAheadResult | null {
  if (world.docked || !ship.alive) return null
  const item = ship.hold.items[index]
  if (!item || item.kind !== 'commodity' || item.commodity.id !== COMMODITIES.FIGURINE.id) {
    return null
  }
  if (item.units < 1) return null

  const rng = world.rng
  // Берём экземпляр из стопки; старые сейвы без specimens — докидываем случайный.
  const specimen = item.specimens?.[0] ?? rollFigurineSpecimen(rng)
  const ahead = range(rng, FIGURINE.DEPLOY_AHEAD_MIN, FIGURINE.DEPLOY_AHEAD_MAX)
  forward(ship.state.quat, _nose)
  _deploy.copy(ship.state.pos).addScaledVector(_nose, ahead)

  const clearance = probeClearance(world, _deploy, specimen.radius)
  if (clearance !== 'ok') return clearance

  const spinAxis = new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5)
  if (spinAxis.lengthSq() < 1e-6) spinAxis.set(0, 1, 0)
  spinAxis.normalize()

  world.figurines.push({
    id: world.ids.next(),
    kind: 'figurine',
    titleId: specimen.titleId,
    variant: specimen.variant,
    pos: _deploy.clone(),
    spinAxis,
    spin: FIGURINE.SPIN * (0.7 + rng() * 0.6),
    radius: specimen.radius,
    alive: true,
  })

  item.units -= 1
  if (item.specimens && item.specimens.length > 0) item.specimens.shift()
  if (item.units <= 0) ship.hold.items.splice(index, 1)
  return 'ok'
}

/** Имена статуэток в трюме — для переговоров и UI. */
export function figurineTitlesInHold(ship: ShipEntity): string[] {
  const out: string[] = []
  for (const it of ship.hold.items) {
    if (it.kind !== 'commodity' || it.commodity.id !== COMMODITIES.FIGURINE.id) continue
    if (it.specimens && it.specimens.length > 0) {
      for (const s of it.specimens) out.push(figurineTitleName(s.titleId))
    } else {
      // Стопка без экземпляров — только счётчик (старый сейв / addCommodity).
      for (let i = 0; i < it.units; i++) out.push(FIGURINE_NAME)
    }
  }
  return out
}

/**
 * Полная коллекция Слова: по одной каждой из каталога.
 * Он — главный собиратель; смертным коллекционерам достаётся 1–2 штуки.
 */
export function stockSlovoCollection(hold: CargoHold, rng: Rng): void {
  const specimens: FigurineSpecimen[] = FIGURINE_TITLES.map((t) => ({
    titleId: t.id,
    variant: Math.floor(rng() * Math.min(FIGURINE.VARIANTS, MONOLITH.VARIANTS)),
    radius: range(rng, FIGURINE.RADIUS_MIN, FIGURINE.RADIUS_MAX),
  }))
  addFigurineSpecimens(hold, specimens)
}
