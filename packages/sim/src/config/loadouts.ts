import type { Chassis } from '../domain/loadout'
import { createLoadout, type Loadout } from '../domain/loadout'
import { ATLAS, AURORA_ONE, HERMES, ORION, PEGASUS, PERSEUS, THESEUS } from './chassis'
import {
  ARMOUR_PLATE,
  BEAM_LASER_HEAVY,
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
  PULSE_LASER_CENTRAL,
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
    AURORA_ONE,
    // Базовый гиперпривод стоит с завода: без него не улететь из системы вообще,
    // а «заработай сорок пять тысяч, чтобы впервые куда-то полететь» — не начало игры.
    // Дальний рейс всё равно надо покупать: девять световых лет — это соседи.
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_STANDARD, ARMOUR_PLATE, CARGO_LARGE, HYPERDRIVE_BASIC, CLOAK_FIELD],
    // ТРИ лазера (класс задаёт цвет луча): ЗЕЛЁНЫЙ класс 2 на СЕРЕДИНЕ крыла, КРАСНЫЙ
    // класс 3 на ЗАКОНЦОВКАХ (по краям), голубой класс 1 «Столб» в ЦЕНТРЕ (носа) — бьёт вдвое
    // реже, но луч втрое толще. Порядок строго по hardpoints: [середина, законцовка, центр,
    // пилон×2]. У Авроры One два пилона (не четыре) — ракеты на обоих.
    [BURST_LASER, BEAM_LASER_HEAVY, PULSE_LASER_CENTRAL, MISSILE_PYLON, MISSILE_PYLON],
  )
}

/** Рядовой пират на лёгком «Гермесе»: слабее игрока по железу, опасен числом. */
export function pirateLoadout(): Loadout {
  return createLoadout(
    // РЭБ в аукс-слоте: пират глушит налетающие ракеты, как и раньше (теперь это модуль,
    // а не врождённая способность — гейт в step одинаков для игрока и бота).
    HERMES,
    [ENGINE_CIVILIAN, RCS_CIVILIAN, SHIELD_LIGHT, ECM_UNIT],
    [PULSE_LASER_WORN],
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
    PEGASUS,
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
    ORION,
    [ENGINE_CIVILIAN, RCS_STANDARD, SHIELD_LIGHT, HYPERDRIVE_COMPACT, ECM_UNIT],
    // «Орион» — [пушка, пилон, пилон]: ствол + две ракеты. Компактный привод для ПОБЕГА.
    [PULSE_LASER, MISSILE_PYLON, MISSILE_PYLON],
  )
}

/**
 * Тяжёлый грузовик. Четыре полных контейнера — трюм за две сотни тонн, и весь он
 * высыпается при гибели. Гражданские маневровые стоят намеренно: разворот баржи
 * должен быть вялым не по прихоти ИИ, а по железу. Два ствола — только огрызаться.
 */
export function freighterLoadout(): Loadout {
  return createLoadout(
    // Тяжёлый рейсовый грузовик — теперь на «Атласе» (корабль поколений): три полных трюма
    // (у «Атласа» три грузовых слота), пара оборонительных стволов. Гружёный ковчег вял и живуч.
    ATLAS,
    [ENGINE_CIVILIAN, RCS_CIVILIAN, SHIELD_STANDARD, ARMOUR_PLATE, CARGO_LARGE, CARGO_LARGE, CARGO_LARGE, HYPERDRIVE_BASIC],
    [PULSE_LASER_WORN, PULSE_LASER_WORN],
  )
}

/**
 * СТОКОВЫЕ СБОРКИ ВЕРФИ. Готовые к вылету корпуса, что продаются на станции: с
 * приводом (иначе из системы не улететь), исправным железом и парой стволов. Игрок,
 * купив, тут же летит — а не собирает корабль из пустых слотов.
 */

/** «Аврора One» — стартовый корпус игрока, он же товар на верфи. */
export function auroraOneLoadout(): Loadout {
  return createLoadout(
    AURORA_ONE,
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_STANDARD, ARMOUR_PLATE, CARGO_SMALL, HYPERDRIVE_BASIC],
    [PULSE_LASER, PULSE_LASER, null, MISSILE_PYLON, MISSILE_PYLON],
  )
}

/**
 * Стоковые сборки истребителей-GLB (Гермес/Персей/Пегас/Орион). Раскладка одна: спаренный
 * лазер + два пилона; корпус и привод — по классу. Отличаются шасси (масса, живучесть, вёрткость).
 */
function fighterLoadout(chassis: Chassis): Loadout {
  return createLoadout(
    chassis,
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_LIGHT, ARMOUR_PLATE, CARGO_SMALL, HYPERDRIVE_COMPACT],
    [PULSE_LASER, MISSILE_PYLON, MISSILE_PYLON],
  )
}
/** «Гермес» — лёгкий скороход. */
export function hermesLoadout(): Loadout {
  return fighterLoadout(HERMES)
}
/** «Персей» — сбалансированный перехватчик. */
export function perseusLoadout(): Loadout {
  return fighterLoadout(PERSEUS)
}
/** «Пегас» — вёрткий, с трюмом. */
export function pegasusLoadout(): Loadout {
  return fighterLoadout(PEGASUS)
}
/** «Орион» — тяжёлый истребитель. */
export function orionLoadout(): Loadout {
  return fighterLoadout(ORION)
}
/** «Тесей» — ещё один лёгкий истребитель на общей раскладке. */
export function theseusLoadout(): Loadout {
  return fighterLoadout(THESEUS)
}

/** «Атлас» — корабль поколений: два лазера на оборону, два пилона, огромный трюм. */
export function atlasLoadout(): Loadout {
  return createLoadout(
    ATLAS,
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_STANDARD, ARMOUR_PLATE, CARGO_LARGE, HYPERDRIVE_BASIC],
    [PULSE_LASER, PULSE_LASER, MISSILE_PYLON, MISSILE_PYLON],
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
  { chassis: AURORA_ONE, loadout: auroraOneLoadout, cost: AURORA_ONE.cost },
  { chassis: HERMES, loadout: hermesLoadout, cost: HERMES.cost },
  { chassis: PERSEUS, loadout: perseusLoadout, cost: PERSEUS.cost },
  { chassis: PEGASUS, loadout: pegasusLoadout, cost: PEGASUS.cost },
  { chassis: ORION, loadout: orionLoadout, cost: ORION.cost },
  { chassis: THESEUS, loadout: theseusLoadout, cost: THESEUS.cost },
  { chassis: ATLAS, loadout: atlasLoadout, cost: ATLAS.cost },
  // Все корпуса теперь — загруженные GLB-модели. Процедурные (Мк III, Арес, Аполлон, Артемида,
  // Афина, Икар, Каркинос, Деметра) сняты из игры. «Каллиопа» (DRONE) корпусом не продаётся —
  // она спасательная капсула (аукс) и шасси боевого роя (`combat/drones.ts`), к верфи не относится.
]
