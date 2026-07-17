import { Vector3 } from 'three'
import { isVisible } from '../combat/cloak'
import { shipAxes } from '../flight/axes'
import type { BodyEntity, ShipEntity, World } from './entities'

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
 * ВСЕ, кого можно захватить: видимые живые борта любой стороны — враги, нейтралы,
 * союзники. Захват — это «на кого смотрю», а не «кого бью»: по цели можно и стрелять,
 * и заговорить, и приказать (если это твой эскорт). Что делать с захваченным, решает
 * игрок; автобой сам стережёт, чтобы не открыть огонь по не-врагу. Маскировку не берём.
 */
export function targetablesOf(world: World): ShipEntity[] {
  // Бог Слово — НЕ борт в космосе: он бот ВНУТРИ станции, только для разговора. Его нельзя
  // захватить и навести; в пространстве его нет вовсе (радар/метки/рамки — тоже мимо, см. HUD).
  return world.ships.filter((s) => s.alive && isVisible(s) && !s.divine)
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
 * Tab — КОНТАКТЫ: живые видимые борта (персонажи) и обломки-контейнеры (останки кораблей).
 * Один круг ПО УДАЛЕНИЮ (ближний — первым, дальше по кругу к дальним). Выбор кладём в своё
 * поле: борт → `lockedTargetId`, контейнер → `lockedPodId` (второе гасит). Небесные тела и
 * станции сюда НЕ входят — их листает Shift+Tab (`cycleCelestial`): контакт и точка навигации
 * независимы, и захват одного не сбивает выбор другого. Мутирует мир, как и прежний захват.
 */
export function cycleContact(world: World): void {
  const from = world.player.state.pos
  const cands: { id: number; pod: boolean; d2: number }[] = [
    ...targetablesOf(world).map((s) => ({ id: s.id, pod: false, d2: s.state.pos.distanceToSquared(from) })),
    ...world.pods.filter((p) => p.alive).map((p) => ({ id: p.id, pod: true, d2: p.pos.distanceToSquared(from) })),
  ]
  if (cands.length === 0) {
    world.lockedTargetId = null
    world.lockedPodId = null
    return
  }
  cands.sort((a, b) => a.d2 - b.d2)
  // Текущий контакт — борт или контейнер; оба id уникальны в общем счётчике.
  const current = world.lockedPodId ?? world.lockedTargetId
  const index = current === null ? -1 : cands.findIndex((c) => c.id === current)
  const next = cands[(index + 1) % cands.length]!
  world.lockedTargetId = next.pod ? null : next.id
  world.lockedPodId = next.pod ? next.id : null
}

/** Небесные тела — точки навигации: звёзды, планеты, спутники, станции, ЧЁРНЫЕ ДЫРЫ.
 *  Дыру HUD рисует крупным ориентиром (primary) и метит нав-целью — значит Shift+Tab обязан
 *  её брать, иначе видимое тело нельзя выбрать. Титаны-киты сюда не входят: они не `BodyEntity`. */
const NAV_KINDS = new Set<BodyEntity['kind']>(['star', 'planet', 'moon', 'station', 'blackhole'])

/**
 * Shift+Tab — НЕБЕСНЫЕ: звёзды, планеты, спутники, станции, чёрные дыры. Один круг ПО УДАЛЕНИЮ. Выбор —
 * в `navTargetId` (та же нав-цель, что метит карта системы, — одна метка на всех). Станцию
 * заодно берём НА СВЯЗЬ (`lockedStationId`, для T-диспетчера), прочее её гасит. Контакт-захват
 * (Tab) не трогаем: борт и точка навигации живут независимо. Мутирует мир.
 */
export function cycleCelestial(world: World): void {
  const from = world.player.state.pos
  const cands: { id: number; pos: Vector3; station: boolean; d2: number }[] = world.bodies
    .filter((b) => NAV_KINDS.has(b.kind))
    .map((b) => ({ id: b.id, pos: b.pos, station: b.kind === 'station', d2: b.pos.distanceToSquared(from) }))
  cands.sort((a, z) => a.d2 - z.d2)
  if (cands.length === 0) {
    world.navTargetId = null
    world.lockedStationId = null
    return
  }
  const index = world.navTargetId === null ? -1 : cands.findIndex((c) => c.id === world.navTargetId)
  const next = cands[(index + 1) % cands.length]!
  world.navTargetId = next.id
  world.lockedStationId = next.station ? next.id : null
}

/**
 * НАВ-ЦЕЛЬ одним видом: где она, какого размера и как зовётся.
 *
 * Разрешение «id → что это» живёт здесь, а не у каждого потребителя: `navTargetId` — ОДНО поле,
 * и приборам нужно ровно это, а не сам `BodyEntity` со всей его орбитальной машинерией.
 */
export interface NavTarget {
  id: number
  pos: Vector3
  radius: number
  name: string
  /** Чем метить и как подписать — HUD решает по виду тела. */
  kind: BodyEntity['kind']
}

/** Что сейчас нав-цель. `null` — не выбрано или пропало. */
export function navTarget(world: World): NavTarget | null {
  const id = world.navTargetId
  if (id === null) return null
  const body = world.bodies.find((b) => b.id === id)
  if (body) return { id, pos: body.pos, radius: body.radius, name: body.name, kind: body.kind }
  return null
}

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
