import { Vector3 } from 'three'
import { MIELOPHONE } from '../../config/mielophone'
import { ASTEROID } from '../../config/world'
import { isVisible } from '../combat/cloak'
import { shipAxes } from '../flight/axes'
import type { AsteroidEntity, BodyEntity, ShipEntity, World } from './entities'
import { figurineDisplayName } from './figurines'

/** Горячий путь: запросы зовутся из кадра HUD, аллокации там недопустимы. */
const _toPlayer = new Vector3()

/** Чтение мира. Ничего не меняет — этим пользуются и HUD, и ИИ. */

export function findShip(world: World, id: number | null): ShipEntity | null {
  if (id === null) return null
  if (world.player.id === id) return world.player
  return world.ships.find((s) => s.id === id) ?? null
}

export function findBody(world: World, id: number | null): BodyEntity | null {
  if (id === null) return null
  return world.bodies.find((b) => b.id === id) ?? null
}

/**
 * Враги, которых видно. Замаскированного в этом списке нет, поэтому его нельзя
 * ни захватить, ни перебрать клавишей: правило видимости одно на всех.
 */
export function hostilesOf(world: World): ShipEntity[] {
  return world.ships.filter((s) => isVisible(s) && s.faction === 'hostile')
}

/**
 * Бот, сидящий ВНУТРИ станции, а не борт в пространстве.
 *
 * Бог Слово живёт в двух ипостасях, и путать их нельзя. В Крестах он приклеен к причалу
 * (`kinematic`, без ИИ) — собеседник, и в космосе его нет вовсе: ни захвата, ни метки, ни
 * отметки на радаре. А ВСТРЕЧНЫЙ бог — настоящий корабль: приходит с кромки радара
 * громадой и ужимается на подходе к станции. Весь смысл этого прилёта в том, чтобы его
 * заметили, подошли и заговорили, — значит он обычная цель, как любой встречный борт.
 *
 * Правило одно на всех: и захват, и метки, и радар спрашивают эту функцию, а не флаг
 * `divine`. Иначе (так и было) видимый корабль-голубь оказывался недоступен для Tab.
 */
export function isStationBot(ship: ShipEntity): boolean {
  return ship.divine === true && ship.kinematic === true
}

/**
 * ВСЕ, кого можно захватить: видимые живые борта любой стороны — враги, нейтралы,
 * союзники. Захват — это «на кого смотрю», а не «кого бью»: по цели можно и стрелять,
 * и заговорить, и приказать (если это твой эскорт). Что делать с захваченным, решает
 * игрок (P бьёт любой физически бьющийся контакт). Маскировку не берём.
 */
export function targetablesOf(world: World): ShipEntity[] {
  return world.ships.filter((s) => s.alive && isVisible(s) && !isStationBot(s))
}

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _toTarget = new Vector3()

/**
 * Следующая цель для захвата: ближайшая к оси прицела, а не просто ближайшая.
 * Игрок ждёт, что Tab возьмёт того, на кого он смотрит.
 */
export function cycleTarget(world: World, currentId: number | null): number | null {
  const candidates = targetablesOf(world)
  if (candidates.length === 0) return null

  shipAxes(world.player.state.quat, _fwd, _right, _up)

  const scored = candidates
    .map((ship) => {
      _toTarget.copy(ship.state.pos).sub(world.player.state.pos)
      const distance = _toTarget.length()
      _toTarget.divideScalar(Math.max(distance, 1e-6))
      // Угол к оси прицела важнее дистанции: сначала те, кто перед носом.
      return { id: ship.id, angle: Math.acos(Math.max(-1, Math.min(1, _fwd.dot(_toTarget)))), distance }
    })
    .sort((a, b) => a.angle - b.angle || a.distance - b.distance)

  if (currentId === null) return scored[0]?.id ?? null

  const index = scored.findIndex((s) => s.id === currentId)
  // Не нашли текущую (погибла) — берём лучшую. Иначе циклим по кругу.
  return scored[(index + 1) % scored.length]?.id ?? scored[0]?.id ?? null
}

/** Станции системы — цели для СВЯЗИ (T), не для атаки. Обычно одна, но перебор общий. */
export function targetableStationsOf(world: World): BodyEntity[] {
  return world.bodies.filter((b) => b.kind === 'station')
}

/**
 * Пауза дольше этого — новый перебор: снова с видимых (перед носом) и ближайших.
 * Быстрые тапы продолжают круг; отпустил и вернулся — не с дальнего «где остановился».
 */
const CYCLE_RESTART = 1.25 // с

/** Перед носом (полусфера) = «видимый» для порядка перебора; маскировка отсекается раньше. */
function facingScore(from: Vector3, pos: Vector3): { facing: number; d2: number } {
  _toTarget.copy(pos).sub(from)
  const d2 = _toTarget.lengthSq()
  if (d2 < 1e-6) return { facing: 1, d2: 0 }
  const facing = _fwd.dot(_toTarget) > 0 ? 1 : 0
  return { facing, d2 }
}

function byFacingThenNear(a: { facing: number; d2: number }, b: { facing: number; d2: number }): number {
  return b.facing - a.facing || a.d2 - b.d2
}

/**
 * Ближе этого астероид попадает в Tab: дальше камень — пейзаж пояса, не контакт.
 * Совпадает с дальностью точек на локаторе (HUD `ROCK_RANGE`).
 */
const ASTEROID_LOCK_RANGE = 4_000
const ASTEROID_LOCK_RANGE_SQ = ASTEROID_LOCK_RANGE * ASTEROID_LOCK_RANGE

type ContactKind = 'ship' | 'pod' | 'asteroid'

/** Снять контактный захват (борт / обломок / камень). */
export function clearContactLock(world: World): void {
  world.lockedTargetId = null
  world.lockedPodId = null
  world.lockedAsteroidId = null
}

/** Снять нав-захват (тело / статуя + связь со станцией). */
export function clearNavLock(world: World): void {
  world.navTargetId = null
  world.lockedStationId = null
}

/**
 * Tab — КОНТАКТЫ: борта, обломки и ближние астероиды. Порядок: перед носом, внутри —
 * по удалению. Свежий перебор (пауза > `CYCLE_RESTART`) — с ближайшего видимого.
 * Выбор: борт → `lockedTargetId`, контейнер → `lockedPodId`, камень → `lockedAsteroidId`
 * (поля взаимно гасятся). Нав гасим — старый фокус не держим. Мутирует мир.
 */
export function cycleContact(world: World): void {
  // С PHASE_END мелкий мир растворён — контакты не перебираем.
  if (world.player.state.scale >= MIELOPHONE.PHASE_END) {
    clearContactLock(world)
    return
  }
  const from = world.player.state.pos
  shipAxes(world.player.state.quat, _fwd, _right, _up)
  const cands: { id: number; kind: ContactKind; facing: number; d2: number }[] = [
    ...targetablesOf(world).map((s) => {
      const rank = facingScore(from, s.state.pos)
      return { id: s.id, kind: 'ship' as const, ...rank }
    }),
    ...world.pods.filter((p) => p.alive).map((p) => {
      const rank = facingScore(from, p.pos)
      return { id: p.id, kind: 'pod' as const, ...rank }
    }),
    ...world.asteroids
      .filter((a) => a.alive && a.pos.distanceToSquared(from) <= ASTEROID_LOCK_RANGE_SQ)
      .map((a) => {
        const rank = facingScore(from, a.pos)
        return { id: a.id, kind: 'asteroid' as const, ...rank }
      }),
  ]
  if (cands.length === 0) {
    clearContactLock(world)
    return
  }
  cands.sort(byFacingThenNear)

  const fresh = world.time - world.contactCycleAt > CYCLE_RESTART
  world.contactCycleAt = world.time
  // Новый контакт вытесняет нав: иначе J/P и портрет спорят со старой планетой.
  clearNavLock(world)
  world.targetFocus = 'contact'

  const current = world.lockedPodId ?? world.lockedAsteroidId ?? world.lockedTargetId
  const index = fresh || current === null ? -1 : cands.findIndex((c) => c.id === current)
  const next = cands[(index + 1) % cands.length]!
  world.lockedTargetId = next.kind === 'ship' ? next.id : null
  world.lockedPodId = next.kind === 'pod' ? next.id : null
  world.lockedAsteroidId = next.kind === 'asteroid' ? next.id : null
}

/** Небесные тела — точки навигации: звёзды, планеты, спутники, станции, ЧЁРНЫЕ ДЫРЫ.
 *  Дыру HUD рисует крупным ориентиром (primary) и метит нав-целью — значит Shift+Tab обязан
 *  её брать, иначе видимое тело нельзя выбрать. Титаны-киты сюда не входят: они не `BodyEntity`. */
const NAV_KINDS = new Set<BodyEntity['kind']>(['star', 'planet', 'moon', 'station', 'blackhole'])

/**
 * После GHOST_BODY система для приборов растворилась: остаются только звёздные ориентиры
 * (звезда / дыра). Станции, планеты, статуи — уже не цели, иначе на миллионах × висит
 * рамка Кориолиса в пустоте.
 */
const STELLAR_KINDS = new Set<BodyEntity['kind']>(['star', 'blackhole'])

/** Звезда или дыра — единственный допустимый нав выше GHOST_BODY. */
export function isStellarNavKind(kind: NavTarget['kind']): boolean {
  return kind === 'star' || kind === 'blackhole'
}

/**
 * Цели, чьи объекты уже «исчезли» для приборов при росте миелофона:
 *  • с PHASE_END — борта/обломки/камни (мелкий мир растворился);
 *  • с GHOST_BODY — планеты/станции/статуи (система отдана галактическому слою).
 * Звезду / дыру не трогаем. Зовётся из cleanup каждого кадра.
 */
export function pruneGiantScaleLocks(world: World): void {
  const scale = world.player.state.scale
  // Корабли и мелочь: фаза кончилась — рамка на призраке недопустима.
  if (scale >= MIELOPHONE.PHASE_END) clearContactLock(world)

  if (scale < MIELOPHONE.GHOST_BODY_SCALE) return
  // Планеты / станции / глыбы: системы в кадре нет — только звезда/дыра.
  const nav = navTarget(world)
  if (!nav || !isStellarNavKind(nav.kind)) clearNavLock(world)
  else {
    world.lockedStationId = null
    world.targetFocus = 'nav'
  }
}

/** Гигант пояса — единственный рудный камень в нав-переборе (мелочь туда не тащим). */
export function isNavBeltAsteroid(a: AsteroidEntity): boolean {
  return a.alive && a.radius >= ASTEROID.NAV_RADIUS
}

/**
 * Shift+Tab — НЕБЕСНЫЕ (+ статуи + глыбы двора + гигант пояса). Тот же порядок, что у
 * контактов: перед носом, потом по удалению; свежий перебор — с ближайшего видимого.
 * Станцию заодно берём на связь (`lockedStationId`). Контакт гасим — старый фокус не держим.
 * Выше GHOST_BODY — только звезда / дыра текущей системы.
 */
export function cycleCelestial(world: World): void {
  const from = world.player.state.pos
  shipAxes(world.player.state.quat, _fwd, _right, _up)
  const stellarOnly = world.player.state.scale >= MIELOPHONE.GHOST_BODY_SCALE
  const kinds = stellarOnly ? STELLAR_KINDS : NAV_KINDS
  const cands = [
    ...world.bodies
      .filter((b) => kinds.has(b.kind))
      .map((b) => {
        const rank = facingScore(from, b.pos)
        return { id: b.id, station: !stellarOnly && b.kind === 'station', ...rank }
      }),
    ...(stellarOnly
      ? []
      : [
          ...world.monoliths.map((m) => {
            const rank = facingScore(from, m.pos)
            return { id: m.id, station: false, ...rank }
          }),
          ...world.figurines
            .filter((f) => f.alive)
            .map((f) => {
              const rank = facingScore(from, f.pos)
              return { id: f.id, station: false, ...rank }
            }),
          ...world.warBases
            .filter((r) => r.alive)
            .map((r) => {
              const rank = facingScore(from, r.pos)
              return { id: r.id, station: false, ...rank }
            }),
          ...world.asteroids
            .filter(isNavBeltAsteroid)
            .map((a) => {
              const rank = facingScore(from, a.pos)
              return { id: a.id, station: false, ...rank }
            }),
        ]),
  ]
  cands.sort(byFacingThenNear)
  if (cands.length === 0) {
    clearNavLock(world)
    return
  }

  const fresh = world.time - world.celestialCycleAt > CYCLE_RESTART
  world.celestialCycleAt = world.time
  // Новая нав-цель вытесняет пирата/обломок — иначе автопилот и огонь смотрят «не туда».
  clearContactLock(world)
  world.targetFocus = 'nav'

  const index = fresh || world.navTargetId === null ? -1 : cands.findIndex((c) => c.id === world.navTargetId)
  const next = cands[(index + 1) % cands.length]!
  world.navTargetId = next.id
  world.lockedStationId = next.station ? next.id : null
}

/**
 * Q: ближайшая цель круга Tab (борт / обломок / камень) — тот же порядок, что у Tab,
 * всегда с головы списка. Не «тот же подкласс»: весь контактный круг. Мутирует мир.
 */
export function retargetNearestContact(world: World): void {
  if (world.player.state.scale >= MIELOPHONE.PHASE_END) {
    clearContactLock(world)
    return
  }
  const from = world.player.state.pos
  shipAxes(world.player.state.quat, _fwd, _right, _up)
  const cands: { id: number; kind: ContactKind; facing: number; d2: number }[] = [
    ...targetablesOf(world).map((s) => {
      const rank = facingScore(from, s.state.pos)
      return { id: s.id, kind: 'ship' as const, ...rank }
    }),
    ...world.pods.filter((p) => p.alive).map((p) => {
      const rank = facingScore(from, p.pos)
      return { id: p.id, kind: 'pod' as const, ...rank }
    }),
    ...world.asteroids
      .filter((a) => a.alive && a.pos.distanceToSquared(from) <= ASTEROID_LOCK_RANGE_SQ)
      .map((a) => {
        const rank = facingScore(from, a.pos)
        return { id: a.id, kind: 'asteroid' as const, ...rank }
      }),
  ]
  if (cands.length === 0) {
    clearContactLock(world)
    return
  }
  cands.sort(byFacingThenNear)
  world.contactCycleAt = world.time
  clearNavLock(world)
  world.targetFocus = 'contact'
  const next = cands[0]!
  world.lockedTargetId = next.kind === 'ship' ? next.id : null
  world.lockedPodId = next.kind === 'pod' ? next.id : null
  world.lockedAsteroidId = next.kind === 'asteroid' ? next.id : null
}

/**
 * Shift+Q: ближайшая цель круга Shift+Tab (небесные / статуи / глыбы).
 * Тот же порядок и состав, что у Shift+Tab, всегда с головы. Мутирует мир.
 */
export function retargetNearestCelestial(world: World): void {
  const from = world.player.state.pos
  shipAxes(world.player.state.quat, _fwd, _right, _up)
  const stellarOnly = world.player.state.scale >= MIELOPHONE.GHOST_BODY_SCALE
  const kinds = stellarOnly ? STELLAR_KINDS : NAV_KINDS
  const cands = [
    ...world.bodies
      .filter((b) => kinds.has(b.kind))
      .map((b) => {
        const rank = facingScore(from, b.pos)
        return { id: b.id, station: !stellarOnly && b.kind === 'station', ...rank }
      }),
    ...(stellarOnly
      ? []
      : [
          ...world.monoliths.map((m) => {
            const rank = facingScore(from, m.pos)
            return { id: m.id, station: false, ...rank }
          }),
          ...world.figurines
            .filter((f) => f.alive)
            .map((f) => {
              const rank = facingScore(from, f.pos)
              return { id: f.id, station: false, ...rank }
            }),
          ...world.warBases
            .filter((r) => r.alive)
            .map((r) => {
              const rank = facingScore(from, r.pos)
              return { id: r.id, station: false, ...rank }
            }),
          ...world.asteroids
            .filter(isNavBeltAsteroid)
            .map((a) => {
              const rank = facingScore(from, a.pos)
              return { id: a.id, station: false, ...rank }
            }),
        ]),
  ]
  cands.sort(byFacingThenNear)
  if (cands.length === 0) {
    clearNavLock(world)
    return
  }
  world.celestialCycleAt = world.time
  clearContactLock(world)
  world.targetFocus = 'nav'
  const next = cands[0]!
  world.navTargetId = next.id
  world.lockedStationId = next.station ? next.id : null
}

/**
 * НАВ-ЦЕЛЬ одним видом: небесное тело, монолит-статуя или глыба (двор / гигант пояса).
 *
 * Монолиты и глыбы живут своими списками (не `BodyEntity`), но выбирать их надо тем же
 * Shift+Tab и метить теми же приборами. Чтобы не плодить второе поле и не учить каждое
 * место о втором списке, `navTargetId` остаётся ОДНИМ полем, а разрешение «id → что это»
 * живёт здесь. Всем потребителям нужно ровно это: где оно, какого размера и как зовётся.
 */
export interface NavTarget {
  id: number
  pos: Vector3
  radius: number
  name: string
  /** Небесное тело, статуя, статуэтка или астероид — HUD решает метку и подпись. */
  kind: BodyEntity['kind'] | 'monolith' | 'figurine' | 'asteroid'
}

/** Имя нав-глыбы: у двора и у гиганта пояса одно — приборы не плодят «камень / глыба / руда». */
export const NAV_ASTEROID_NAME = 'Астероид'

/** Что сейчас нав-цель: тело, монолит или глыба. `null` — не выбрано или пропало. */
export function navTarget(world: World): NavTarget | null {
  const id = world.navTargetId
  if (id === null) return null
  const body = world.bodies.find((b) => b.id === id)
  if (body) return { id, pos: body.pos, radius: body.radius, name: body.name, kind: body.kind }
  const monolith = world.monoliths.find((m) => m.id === id)
  if (monolith) return { id, pos: monolith.pos, radius: monolith.radius, name: MONOLITH_NAMES[monolith.variant] ?? 'Монолит', kind: 'monolith' }
  const figurine = world.figurines.find((f) => f.id === id && f.alive)
  if (figurine) {
    return {
      id,
      pos: figurine.pos,
      radius: figurine.radius,
      name: figurineDisplayName(figurine),
      kind: 'figurine',
    }
  }
  const warBase = world.warBases.find((r) => r.id === id && r.alive)
  if (warBase) return { id, pos: warBase.pos, radius: warBase.radius, name: NAV_ASTEROID_NAME, kind: 'asteroid' }
  const giant = world.asteroids.find((a) => a.id === id && isNavBeltAsteroid(a))
  if (giant) return { id, pos: giant.pos, radius: giant.radius, name: NAV_ASTEROID_NAME, kind: 'asteroid' }
  return null
}

/**
 * Имена статуй ПО ОБЛИКУ — порядок обязан совпадать с реестром мешей (`statueGlb.ts`).
 * Данные, не ветвление: новая статуя — строка здесь и строка там.
 */
export const MONOLITH_NAMES: readonly string[] = ['Люцифер', 'Шива', 'Тутанхамон']

/** Ближайший контейнер в радиусе захвата — HUD подсказывает, что можно подобрать. */
export function nearestPod(world: World, radius: number) {
  let best = null
  let bestDistance = radius
  for (const pod of world.pods) {
    if (!pod.alive) continue
    const distance = pod.pos.distanceTo(world.player.state.pos)
    if (distance < bestDistance) {
      bestDistance = distance
      best = pod
    }
  }
  return best
}

/**
 * Идёт ли на игрока ракета — и сколько секунд до подхода ближайшей.
 *
 * Возвращает `null`, если чисто. Время считается по скорости СБЛИЖЕНИЯ, а не по
 * скорости ракеты: догоняющая сзади ракета подходит медленнее встречной, и HUD
 * не должен пугать раньше срока. Отрицательное сближение (ракета отстаёт после
 * срыва наведения) значит, что она уже не угроза.
 */
export function incomingMissile(world: World): { seconds: number; distance: number } | null {
  const player = world.player
  if (!player.alive) return null

  let soonest: { seconds: number; distance: number } | null = null
  for (const m of world.missiles) {
    if (!m.alive || m.targetId !== player.id) continue

    _toPlayer.copy(player.state.pos).sub(m.pos)
    const distance = _toPlayer.length()
    if (distance < 1e-3) continue

    // Сближение = проекция скорости ракеты на линию визирования.
    const closing = m.vel.dot(_toPlayer) / distance - player.state.vel.dot(_toPlayer) / distance
    if (closing <= 1) continue

    const seconds = distance / closing
    if (!soonest || seconds < soonest.seconds) soonest = { seconds, distance }
  }
  return soonest
}
