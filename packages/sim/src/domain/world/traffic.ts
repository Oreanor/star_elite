import { Quaternion, Vector3 } from 'three'
import { traderLoadout } from '../../config/loadouts'
import { TRAFFIC } from '../../config/world'
import { signed } from '../../core/math'
import { createAIState } from '../ai/types'
import { makeShip } from './factory'
import type { ShipEntity, World } from './entities'

/**
 * Мирное движение: торговцы вылетают со станции и пролетают мимо.
 *
 * Космос без них — тир. Нейтрал не дерётся и не является добычей: `isHostileTo`
 * не считает его врагом никому, поэтому пираты его не трогают, а он их. Он просто
 * летит по своим делам, и этого достаточно, чтобы система перестала быть пустой.
 *
 * Темп задан ПЕРЕЗАРЯДОМ В СЕКУНДАХ. Бросок `rng() < p` внутри шага физики — это
 * не «редко»: при 120 Гц он срабатывает вдвое чаще, чем при 60, и трафик менялся
 * бы вместе с частотой шага.
 *
 * Рождение и смерть кораблей — событие для слоя приложения: контроллеры новым
 * кораблям раздаёт он. Симуляция об этом не знает и знать не должна.
 */

const _scratch = new Vector3()

/** Единичный вектор в случайную сторону. Записывает в `out`. */
function randomDirection(world: World, out: Vector3): Vector3 {
  do {
    out.set(signed(world.rng), signed(world.rng), signed(world.rng))
  } while (out.lengthSq() < 1e-6)
  return out.normalize()
}

const neutralCount = (world: World) => world.ships.filter((s) => s.alive && s.faction === 'neutral').length

/**
 * Где родится торговец и куда полетит.
 *
 * Со станции — если она есть: корабль отваливает от причала и уходит наружу.
 * Иначе (и в половине случаев) он просто пролетает мимо игрока, появившись
 * за пределом видимости и правя на другую сторону.
 */
function spawnSite(world: World, outPos: Vector3, outHome: Vector3): void {
  const station = world.bodies.find((b) => b.kind === 'station')

  if (station && world.rng() < TRAFFIC.STATION_SHARE) {
    randomDirection(world, _scratch)
    // Чуть в стороне от причала: рождённый в горловине корабль таранит станцию.
    outPos.copy(station.pos).addScaledVector(_scratch, station.radius * 3)
    outHome.copy(station.pos).addScaledVector(_scratch, TRAFFIC.DESTINATION_RANGE)
    return
  }

  randomDirection(world, _scratch)
  outPos.copy(world.player.state.pos).addScaledVector(_scratch, TRAFFIC.SPAWN_RANGE)
  // Правит на противоположную сторону: маршрут проходит мимо игрока, а не вокруг.
  outHome.copy(world.player.state.pos).addScaledVector(_scratch, -TRAFFIC.DESTINATION_RANGE)
}

function spawnTrader(world: World): ShipEntity {
  const pos = new Vector3()
  const home = new Vector3()
  spawnSite(world, pos, home)

  const quat = new Quaternion().setFromUnitVectors(
    new Vector3(0, 0, -1),
    _scratch.copy(home).sub(pos).normalize(),
  )

  const ship = makeShip(world.ids, 'neutral', 'Торговец', traderLoadout(), pos, quat)
  // Дом — не место рождения, а НАЗНАЧЕНИЕ: патрульный круг бота вьётся вокруг дома,
  // значит корабль сперва долетит до цели, а уже там начнёт кружить.
  ship.ai = createAIState(home, world.rng)
  ship.controls.throttle = 0.7

  world.ships.push(ship)
  return ship
}

/**
 * Убрать тех, кто улетел за горизонт событий игрока.
 *
 * Захваченную цель не трогаем: пилот на неё смотрит, и корабль, растворившийся
 * в рамке прицела, выглядит поломкой, а не уходом за пределы радара.
 */
function despawnDistant(world: World): void {
  const limitSq = TRAFFIC.DESPAWN_RANGE * TRAFFIC.DESPAWN_RANGE
  world.ships = world.ships.filter((s) => {
    if (s.faction !== 'neutral' || !s.alive) return true
    if (s.id === world.lockedTargetId) return true
    return s.state.pos.distanceToSquared(world.player.state.pos) <= limitSq
  })
}

/** Шаг трафика. Возвращает родившийся корабль — приложению надо дать ему пилота. */
export function stepTraffic(world: World, dt: number): ShipEntity | null {
  despawnDistant(world)

  world.trafficTimer -= dt
  if (world.trafficTimer > 0) return null

  world.trafficTimer = TRAFFIC.INTERVAL
  if (neutralCount(world) >= TRAFFIC.MAX) return null

  return spawnTrader(world)
}
