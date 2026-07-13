import type { Chassis } from '../domain/loadout'
import { createLoadout, type Loadout } from '../domain/loadout'
import { APOLLO, ARTEMIS, ATHENA, AURORA_MK3, DRONE, LARGE_FREIGHTER, SIDEWINDER } from './chassis'
import {
  ARMOUR_PLATE,
  BURST_LASER,
  CLOAK_FIELD,
  ECM_UNIT,
  CARGO_LARGE,
  CARGO_SMALL,
  ENGINE_CIVILIAN,
  ENGINE_STANDARD,
  HYPERDRIVE_BASIC,
  HYPERDRIVE_COMPACT,
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
    AURORA_MK3,
    // Базовый гиперпривод стоит с завода: без него не улететь из системы вообще,
    // а «заработай сорок пять тысяч, чтобы впервые куда-то полететь» — не начало игры.
    // Дальний рейс всё равно надо покупать: девять световых лет — это соседи.
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_STANDARD, ARMOUR_PLATE, CARGO_LARGE, HYPERDRIVE_BASIC, CLOAK_FIELD],
    // Два лазера в крыльевых слотах (середина и концы крыльев), центральный тяжёлый слот
    // пуст — под него докупается толстый луч. Ракеты на четырёх пилонах. Мунишн-слот держит
    // ОДИН тип на ВСЕХ пилонах: на старте обычные ракеты. Дрон-ракеты — другой тип того же
    // слота, их покупают на станции и ставят ВЗАМЕН, поэтому на старте контейнера БПЛА нет.
    [BURST_LASER, BURST_LASER, null, MISSILE_PYLON, MISSILE_PYLON, MISSILE_PYLON, MISSILE_PYLON],
  )
}

/** Рядовой пират: слабее игрока по железу, опасен числом. */
export function pirateLoadout(): Loadout {
  return createLoadout(
    // РЭБ в аукс-слоте: пират глушит налетающие ракеты, как и раньше (теперь это модуль,
    // а не врождённая способность — гейт в step одинаков для игрока и бота).
    SIDEWINDER,
    [ENGINE_CIVILIAN, RCS_CIVILIAN, SHIELD_LIGHT, ECM_UNIT],
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

/**
 * Главарь: исправные стволы и одна ракета на пилоне. С него есть что снять.
 *
 * Компактный гиперпривод — не для дальних рейсов, а для ПОБЕГА: проигрывая бой,
 * главарь может уйти из системы прыжком (см. `WARP`), а рядовой пират — нет.
 * Оттого уход прыжком и остаётся редким: на нём способен уйти не каждый встречный.
 */
export function pirateLeaderLoadout(): Loadout {
  return createLoadout(
    SIDEWINDER,
    [ENGINE_CIVILIAN, RCS_STANDARD, SHIELD_LIGHT, HYPERDRIVE_COMPACT, ECM_UNIT],
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

/**
 * СТОКОВЫЕ СБОРКИ ВЕРФИ. Готовые к вылету корпуса, что продаются на станции: с
 * приводом (иначе из системы не улететь), исправным железом и парой стволов. Игрок,
 * купив, тут же летит — а не собирает корабль из пустых слотов.
 */

/** «Арес» — лёгкий истребитель: вёрткий, с бронеплитой, ствол и ракетный пилон. */
export function aresLoadout(): Loadout {
  return createLoadout(
    SIDEWINDER,
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_LIGHT, ARMOUR_PLATE, CARGO_SMALL, HYPERDRIVE_COMPACT],
    [PULSE_LASER, PULSE_LASER, MISSILE_PYLON],
  )
}

/** «Каллиопа» — крошечный скаут: почти без брони, но один ствол и компактный привод. */
export function calliopeLoadout(): Loadout {
  return createLoadout(DRONE, [ENGINE_CIVILIAN, RCS_CIVILIAN, HYPERDRIVE_COMPACT], [PULSE_LASER])
}

/** «Аполлон» — X-винг-перехватчик: лазеры на нижних и верхних крыльях, центр пуст, два пилона. */
export function apolloLoadout(): Loadout {
  return createLoadout(
    APOLLO,
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_STANDARD, ARMOUR_PLATE, CARGO_SMALL, HYPERDRIVE_BASIC],
    [PULSE_LASER, PULSE_LASER, null, MISSILE_PYLON, MISSILE_PYLON],
  )
}

/** «Артемида» — ударный: крепкий щит и броня, два ствола и два пилона. */
export function artemisLoadout(): Loadout {
  return createLoadout(
    ARTEMIS,
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_STANDARD, ARMOUR_PLATE, CARGO_SMALL, HYPERDRIVE_BASIC],
    [PULSE_LASER, PULSE_LASER, MISSILE_PYLON, MISSILE_PYLON],
  )
}

/** «Афина» — стелс: маскировочное поле на борту, два ствола и пилон. */
export function athenaLoadout(): Loadout {
  return createLoadout(
    ATHENA,
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_LIGHT, ARMOUR_PLATE, CARGO_SMALL, HYPERDRIVE_BASIC, CLOAK_FIELD],
    [PULSE_LASER, PULSE_LASER, MISSILE_PYLON],
  )
}

/**
 * Каталог верфи: какие корпуса можно взять на станции и с какой сборкой. Цена пока
 * ноль — «дают погонять». Новый корабль — новая строка, а не ветка в коде (OCP):
 * рендер знает геометрию по `chassis.id`, домен — как поставить сборку.
 */
export interface HullOffer {
  readonly chassis: Chassis
  readonly loadout: () => Loadout
  readonly cost: number
}

export const SHIPYARD: readonly HullOffer[] = [
  { chassis: AURORA_MK3, loadout: playerStartLoadout, cost: AURORA_MK3.cost },
  { chassis: APOLLO, loadout: apolloLoadout, cost: APOLLO.cost },
  { chassis: ARTEMIS, loadout: artemisLoadout, cost: ARTEMIS.cost },
  { chassis: ATHENA, loadout: athenaLoadout, cost: ATHENA.cost },
  { chassis: SIDEWINDER, loadout: aresLoadout, cost: SIDEWINDER.cost },
  { chassis: LARGE_FREIGHTER, loadout: freighterLoadout, cost: LARGE_FREIGHTER.cost },
  { chassis: DRONE, loadout: calliopeLoadout, cost: DRONE.cost },
]
