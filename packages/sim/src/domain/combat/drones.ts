import { Vector3 } from 'three'
import { DRONE } from '../../config/chassis'
import { DRONE_LASER } from '../../config/modules'
import { ENGINE_CIVILIAN, RCS_CIVILIAN } from '../../config/modules'
import { createAIState } from '../ai'
import { createLoadout, isDrone } from '../loadout'
import { shipAxes } from '../flight/axes'
import type { ShipEntity, World } from '../world/entities'
import { makeShip } from '../world/factory'
import { spawnExplosion } from './effects'

/**
 * Беспилотники. Сходят с пилона, как ракета, но дальше живут как КОРАБЛЬ:
 * тот же `stepShip`, тот же `Controller`, тот же ИИ, что летает у пиратов.
 *
 * Отсюда всё их поведение и берётся, без единой строки «правил для БПЛА».
 * Враг видит их через тот же `selectTarget`, что и любую цель, и переключается
 * на ближайшую — то есть на аппарат, который вертится у него перед носом.
 * Это и есть «оттянуть внимание»: не флаг агрессии, а геометрия.
 *
 * Слабость их — тоже не множитель, а железо: гражданский двигатель, картонный
 * корпус, ствол на три единицы урона. Пирата они не убьют, и не должны.
 */

const _fwd = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _spawn = new Vector3()

/** Сборка беспилотника. Одна на всех: аппарат — расходник, а не корабль пилота. */
const droneLoadout = () => createLoadout(DRONE, [ENGINE_CIVILIAN, RCS_CIVILIAN], [DRONE_LASER])

/** Аппарат, а не корабль: у обломка нет трофеев, и в счёт побед он не идёт. */
export const isDroneShip = (e: ShipEntity): boolean => e.droneOf !== null

/** Сколько аппаратов этого носителя ещё в воздухе. */
export function activeDrones(world: World, owner: ShipEntity): number {
  let count = 0
  for (const s of world.ships) if (s.alive && s.droneOf === owner.id) count++
  return count
}

/**
 * Выпустить аппарат с готового контейнера.
 *
 * Разлетаются в стороны попеременно, от числа уже выпущенных: два аппарата,
 * рождённых в одной точке, вытолкнули бы друг друга столкновением.
 *
 * @returns выпущенный аппарат, либо null — нечем, некуда или уже некогда.
 */
export function launchDrone(world: World, owner: ShipEntity): ShipEntity | null {
  if (!owner.alive) return null

  const index = owner.spec.mounts.findIndex(
    (m, i) => isDrone(m.weapon) && (owner.guns[i]?.ammo ?? 0) > 0 && (owner.guns[i]?.cooldown ?? 0) <= 0,
  )
  if (index < 0) return null

  const mount = owner.spec.mounts[index]
  const gun = owner.guns[index]
  if (!mount || !gun || !isDrone(mount.weapon)) return null

  const bay = mount.weapon
  const flying = activeDrones(world, owner)
  if (flying >= bay.maxActive) return null

  gun.ammo -= 1
  gun.cooldown = 1.2 // пусковая, не орудие

  shipAxes(owner.state.quat, _fwd, _right, _up)
  // Вбок и вверх: аппарат обязан выйти из-под собственного корпуса носителя,
  // иначе первый же шаг столкновений разбросает их обоих.
  const side = flying % 2 === 0 ? 1 : -1
  const lateral = (owner.spec.hull.radius + DRONE.radius + 4) * side
  _spawn.copy(owner.state.pos).addScaledVector(_right, lateral).addScaledVector(_up, 3)

  const drone = makeShip(world.ids, owner.faction, DRONE.name, droneLoadout(), _spawn, owner.state.quat)
  // Сходит со скоростью носителя: аппарат, рождённый неподвижным, мгновенно
  // остаётся за кормой и всю жизнь догоняет бой.
  drone.state.vel.copy(owner.state.vel)
  drone.ai = createAIState(_spawn, world.rng)
  drone.droneOf = owner.id
  drone.dieAt = world.time + bay.lifetime

  world.ships.push(drone)
  return drone
}

/**
 * Самоликвидация по сроку. Зовётся раз в кадр, а не раз в шаг физики: срок
 * задан в СЕКУНДАХ, и от частоты шага зависеть не должен.
 *
 * Аппарат не «исчезает» — он взрывается, как всякий погибший корабль. Обломков
 * от него не остаётся (см. `cleanup`), но вспышка обязана быть: пилот должен
 * видеть, что его прикрытие кончилось.
 */
export function expireDrones(world: World): void {
  for (const s of world.ships) {
    if (!s.alive || s.dieAt === null || world.time < s.dieAt) continue
    s.alive = false
    spawnExplosion(world, s.state.pos, s.state.vel, 1.4)
  }
}
