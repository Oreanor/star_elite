import type { Quaternion, Vector3 } from 'three'
import { playerStartLoadout } from '../../config/loadouts'
import { makeShip } from './factory'
import type { ShipEntity, World } from './entities'

/**
 * Удалённый игрок в мире. Это ОБЫЧНЫЙ `ShipEntity` в `world.ships` — чтобы бой,
 * наведение и рендер работали по нему без ветки «а это сетевой». Отличие одно: он
 * `kinematic` (см. `entities.ts`), поэтому шаг мира его не рулит и не двигает — позу
 * ставит интерполятор снапшотов в слое app.
 *
 * Домен НЕ знает про сеть: откуда взялись имя, вид и поза — не его забота. Он лишь
 * даёт собрать и убрать такой борт, переиспользуя ту же фабрику, что и для ботов.
 */

export interface RemotePlayerInit {
  /** Отображаемое имя (у живого игрока открыто сразу — это не незнакомец с радара). */
  name: string
  /** Вид пилота — для портрета (тот же лист, что у ботов у причала). */
  species: string
  /** Индекс лица в листе портретов (выбран игроком при создании персонажа). */
  portrait: number
  /** Стартовая поза; дальше её ведёт интерполятор. */
  pos: Vector3
  quat: Quaternion
}

/**
 * Материализовать чужого игрока кинематическим бортом. Корабль — дефолтный
 * (`playerStartLoadout`): у всех игроков он одинаков на старте; настоящее шасси
 * синхронизируем позже. Фракция `neutral`: чужой человек — не враг и не полиция, а
 * `player` зарезервирована за ЛОКАЛЬНЫМ игроком (по ней считаются очки, бомба, обиды).
 */
export function spawnRemotePlayer(world: World, init: RemotePlayerInit): ShipEntity {
  const ship = makeShip(world.ids, 'neutral', init.name, playerStartLoadout(), init.pos, init.quat)
  ship.persona = { ...ship.persona, species: init.species, portrait: init.portrait }
  ship.kinematic = true
  world.ships.push(ship)
  return ship
}

/** Убрать чужого игрока (вышел из системы или из игры). Тихо: ни взрыва, ни трофеев. */
export function despawnRemotePlayer(world: World, id: number): void {
  world.ships = world.ships.filter((s) => s.id !== id)
}
