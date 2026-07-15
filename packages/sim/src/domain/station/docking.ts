import { Vector3 } from 'three'
import { DOCKING } from '../../config/station'
import type { BodyEntity, ShipEntity, World } from '../world/entities'
import { startAtStation } from '../world/factory'
import { stepOrbits } from '../world/orbits'

/**
 * Стыковка. Домен знает только состояние «пристыкован» и условия входа-выхода;
 * ни кнопок, ни меню, ни автопилота здесь нет — автопилот это обычный Controller.
 */

const _toStation = new Vector3()
const _noseRest = new Vector3(0, 0, -1)

/**
 * Станция, к которой пилот сейчас имеет дело, — БЛИЖАЙШАЯ. В системе бывает две станции
 * (два Кориолиса у разных планет); брать первую в списке значило бы, что подсказка и
 * автопилот дёргают не ту, а стыковка «триггерится» у обеих разом. Ближайшая — та, к
 * которой ты и подлетаешь.
 */
export function findStation(world: World): BodyEntity | null {
  const from = world.player.state.pos
  let best: BodyEntity | null = null
  let bestSq = Infinity
  for (const b of world.bodies) {
    if (b.kind !== 'station') continue
    const d = b.pos.distanceToSquared(from)
    if (d < bestSq) {
      bestSq = d
      best = b
    }
  }
  return best
}

/** Расстояние до причального кольца, м. Отрицательного не бывает. */
export function stationRange(ship: ShipEntity, station: BodyEntity): number {
  return Math.max(0, station.pos.distanceTo(ship.state.pos) - station.radius)
}

/**
 * Порог стыковки (и взвода) от кольца, м. Растёт с радиусом станции: у станции-гиганта
 * фиксированные 220 м попали бы ВНУТРЬ защитного поля (1.15·R), и оно отбивало бы корабль,
 * не дав дотянуться. Держим зону на 0.3·R — снаружи поля (но не тоньше DOCKING.RANGE).
 */
export function dockThreshold(station: BodyEntity): number {
  return Math.max(DOCKING.RANGE, station.radius * DOCKING.RANGE_FACTOR)
}

/**
 * Можно ли стыковаться прямо сейчас. Скорость важна не меньше дистанции:
 * влететь в причал на двухстах метрах в секунду — это не стыковка, а таран.
 *
 * В масштабе (миелофон) стыковка невозможна: гигант не влезет в причал. Диспетчер по
 * связи так и отвечает — сожмись до обычного размера. `scale <= 1` — обычный корабль.
 */
export function canDockAt(ship: ShipEntity, station: BodyEntity): boolean {
  return (
    ship.alive &&
    ship.state.scale <= 1 &&
    stationRange(ship, station) < dockThreshold(station) &&
    ship.state.vel.length() < DOCKING.MAX_SPEED
  )
}

export function dock(world: World): boolean {
  const station = findStation(world)
  if (!station || world.docked || !world.dockArmed || !canDockAt(world.player, station)) return false

  world.docked = true
  world.player.landedOn = null
  world.player.state.vel.set(0, 0, 0)
  world.player.state.angVel.set(0, 0, 0)
  world.player.controls.throttle = 0
  world.player.cruise.factor = 1
  // Причал заправляет привод под завязку: заряжаться у звезды — риск, а станция
  // берёт за это деньгами (когда появится счёт). Второй путь к тому же полному баку.
  world.player.jumpCharge = world.player.spec.jumpRange
  return true
}

/**
 * Начать ПРИСТЫКОВАННЫМ. Ставим вплотную к причалу (RELEASE_GAP < RANGE, скорость ноль)
 * и стыкуем общим путём `dock()` — игрок открывает глаза уже в доке станции, а не в
 * километре в открытом космосе. Для старта новой сессии: и точка возврата, и безопасно.
 */
export function startDocked(world: World): void {
  startAtStation(world, DOCKING.RELEASE_GAP)
  dock(world)
}

/**
 * Взвод стыковки. Сам шаг мира БОЛЬШЕ НЕ стыкует по касанию: врезаться в станцию нельзя,
 * поле отпружинивает корабль без допуска (см. `stepBodyCollisions`). Стыковка теперь —
 * только автопилотом по L, который ведёт корабль коридором и сам зовёт `dock()`. Здесь
 * остаётся лишь взвод: покинул зону причала — стыковка снова разрешена (порог общий с
 * `canDockAt`, поэтому взвод не срабатывает там, где стыковка уже возможна).
 */
export function stepDocking(world: World): void {
  if (world.docked) return

  const station = findStation(world)
  if (!station) return

  if (!world.dockArmed && stationRange(world.player, station) >= dockThreshold(station)) world.dockArmed = true
}

/** Выпускает корабль наружу, носом от станции: иначе первый же кадр — столкновение. */
export function undock(world: World): void {
  if (!world.docked) return

  // Пока меню дока открыто, физика стоит, но календарь продолжает идти. Сначала
  // запоминаем именно свой причал, затем ставим всю систему на свежий момент.
  const station = findStation(world)
  if (!station) return
  stepOrbits(world)

  world.docked = false
  world.dockArmed = false

  const player = world.player

  const host = station.orbit?.parentId == null
    ? null
    : world.bodies.find((body) => body.id === station.orbit!.parentId)
  // Выходим наружу от планеты-хозяина. Старое положение игрока использовать
  // нельзя: после обновления календарной орбиты оно может быть в миллионах км.
  _toStation.copy(station.pos).sub(host?.pos ?? player.state.pos)
  if (_toStation.lengthSq() < 1e-6) _toStation.set(0, 0, 1)
  _toStation.normalize()

  player.state.pos.copy(station.pos).addScaledVector(_toStation, station.radius + DOCKING.RELEASE_GAP)
  player.state.vel.copy(_toStation).multiplyScalar(DOCKING.RELEASE_SPEED)

  // Разворачиваем носом наружу: смотреть в станцию при отчаливании незачем.
  player.state.quat.setFromUnitVectors(_noseRest, _toStation)
  player.state.angVel.set(0, 0, 0)
  player.controls.throttle = 0.3
}
