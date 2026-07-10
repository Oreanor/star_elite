import { createLoadout, type Loadout } from '../domain/loadout'
import { COBRA_MK3, LARGE_FREIGHTER, SIDEWINDER } from './chassis'
import {
  ARMOUR_PLATE,
  BURST_LASER,
  CLOAK_FIELD,
  DRONE_BAY,
  CARGO_LARGE,
  CARGO_SMALL,
  ENGINE_CIVILIAN,
  ENGINE_STANDARD,
  HYPERDRIVE_BASIC,
  MISSILE_PYLON,
  PULSE_LASER,
  PULSE_LASER_WORN,
  RCS_CIVILIAN,
  RCS_STANDARD,
  SHIELD_LIGHT,
  SHIELD_STANDARD,
} from './modules'

/**
 * Стартовые сборки. Игрок начинает на исправном, но ничем не примечательном корабле:
 * всё интересное покупается или снимается с обломков.
 */

/**
 * Замер показал, почему бой не разрешался: даже бот, ведущий нос идеально,
 * держит цель в прицеле лишь 7% времени и попадает четвертью выстрелов.
 * Полезный урон выходит около 2% от паспортного, и пират с 80 живучести
 * умирал минуту. Поэтому у игрока класс-2 стволы и бронеплиты: не «баланс»,
 * а признание того, что в свалке огневого контакта почти нет.
 */
export function playerStartLoadout(): Loadout {
  return createLoadout(
    COBRA_MK3,
    // Базовый гиперпривод стоит с завода: без него не улететь из системы вообще,
    // а «заработай сорок пять тысяч, чтобы впервые куда-то полететь» — не начало игры.
    // Дальний рейс всё равно надо покупать: девять световых лет — это соседи.
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_STANDARD, ARMOUR_PLATE, CARGO_LARGE, HYPERDRIVE_BASIC, CLOAK_FIELD],
    // Два ствола и четыре пусковых на пилонах — по индексам точек подвески шасси.
    // Каждая несёт по две ракеты, итого восемь на вылет.
    // Последний пилон отдан контейнеру БПЛА: три пилона ракет — шесть ракет.
    [BURST_LASER, BURST_LASER, MISSILE_PYLON, MISSILE_PYLON, MISSILE_PYLON, DRONE_BAY],
  )
}

/** Рядовой пират: слабее игрока по железу, опасен числом. */
export function pirateLoadout(): Loadout {
  return createLoadout(
    SIDEWINDER,
    [ENGINE_CIVILIAN, RCS_CIVILIAN, SHIELD_LIGHT],
    [PULSE_LASER_WORN, PULSE_LASER_WORN],
  )
}

/**
 * Мирный торговец. Трюм вместо брони, один изношенный ствол на всякий случай.
 *
 * Он не безоружен намеренно: беззащитная мишень, которую нельзя даже спугнуть,
 * превращает нейтралов в декорацию. Но драться ему нечем, и это видно по железу,
 * а не назначено правилом.
 */
export function traderLoadout(): Loadout {
  return createLoadout(
    SIDEWINDER,
    [ENGINE_CIVILIAN, RCS_CIVILIAN, SHIELD_LIGHT, CARGO_SMALL],
    [PULSE_LASER_WORN],
  )
}

/** Главарь: исправные стволы и одна ракета на пилоне. С него есть что снять. */
export function pirateLeaderLoadout(): Loadout {
  return createLoadout(
    SIDEWINDER,
    [ENGINE_CIVILIAN, RCS_STANDARD, SHIELD_LIGHT],
    [PULSE_LASER, PULSE_LASER, MISSILE_PYLON],
  )
}

/**
 * Тяжёлый грузовик. Четыре полных контейнера — трюм за две сотни тонн, и весь он
 * высыпается при гибели. Гражданские маневровые стоят намеренно: разворот баржи
 * должен быть вялым не по прихоти ИИ, а по железу. Два ствола — только огрызаться.
 */
export function freighterLoadout(): Loadout {
  return createLoadout(
    LARGE_FREIGHTER,
    [ENGINE_CIVILIAN, RCS_CIVILIAN, SHIELD_STANDARD, ARMOUR_PLATE, CARGO_LARGE, CARGO_LARGE, CARGO_LARGE, CARGO_LARGE, HYPERDRIVE_BASIC],
    [PULSE_LASER_WORN, PULSE_LASER_WORN],
  )
}
