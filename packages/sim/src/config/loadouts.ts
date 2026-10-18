import { createLoadout, type Chassis, type Loadout } from './schema'
import type { Government } from './galaxy'
import { ATHENA, ATLAS, AURORA_ONE, HERMES, ICARUS, ORION, PEGASUS, PERSEUS, SPIRITUS_SANCTUS, THESEUS } from './chassis'
import {
  ARMOUR_COMPOSITE,
  ARMOUR_PLATE,
  ARMOUR_STEEL_2,
  ARMOUR_STEEL_3,
  BEAM_LASER,
  BEAM_LASER_HEAVY,
  BURST_LASER,
  CLOAK_FIELD,
  ECM_UNIT,
  MIELOPHONE_DEVICE,
  CARGO_LARGE,
  CARGO_SMALL,
  ENGINE_CIVILIAN,
  ENGINE_MILITARY_C,
  ENGINE_STANDARD,
  HYPERDRIVE_BASIC,
  HYPERDRIVE_COMPACT,
  HYPERDRIVE_HAULER,
  HYPERDRIVE_HAULER_B,
  HYPERDRIVE_LONG,
  MISSILE_HEAVY,
  MISSILE_PYLON,
  PULSE_LASER,
  PULSE_LASER_CENTRAL,
  PULSE_LASER_WORN,
  RCS_CIVILIAN,
  RCS_MILITARY_C,
  RCS_STANDARD,
  SHIELD_CIVILIAN_2,
  SHIELD_HEAVY_C,
  SHIELD_LIGHT,
  SHIELD_STANDARD,
  SHIELD_STANDARD_B,
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
/**
 * КОРАБЛЬ БОГА — «Святой Дух» (Spiritus Sanctus): та же рама, одно центральное сопло, без
 * пилонов. Раньше бог летал на СБОРКЕ ИГРОКА, оттого и корабль игрока звался Святым Духом.
 * Оружия ему не даём: он не дерётся. Зато у него МИЕЛОФОН — оттого он и приходит в трафик
 * то обычным бортом, то стометровой громадой: масштаб у него не свойство, а прибор.
 */
export function godLoadout(): Loadout {
  return createLoadout(SPIRITUS_SANCTUS, [ENGINE_STANDARD, RCS_STANDARD, SHIELD_STANDARD, MIELOPHONE_DEVICE], [])
}

/**
 * КОРАБЛЬ ИГРОКА — «Ника»: серийный корпус из ДЕШЁВЫХ. Начинаешь снизу лестницы корпусов,
 * чтобы было куда расти: «Афина», «Орион», «Гермес» — уже покупки. Железо — не выше второго
 * класса: маскировка и «Клинок» третьего на старте не стоят, их зарабатывают.
 */
export function playerStartLoadout(): Loadout {
  return createLoadout(
    AURORA_ONE,
    // Базовый гиперпривод стоит с завода: без него не улететь из системы вообще,
    // а «заработай сорок пять тысяч, чтобы впервые куда-то полететь» — не начало игры.
    // Дальний рейс всё равно надо покупать: девять световых лет — это соседи.
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_STANDARD, ARMOUR_PLATE, CARGO_LARGE, HYPERDRIVE_BASIC],
    // ЗЕЛЁНЫЙ класс 2 на середине крыла, лучевой класс 2 на законцовках, голубой «Столб» в
    // носу; пара пилонов снаряжена с завода.
    [BURST_LASER, BEAM_LASER, PULSE_LASER_CENTRAL, MISSILE_PYLON, MISSILE_PYLON],
  )
}

/**
 * ПОЛНАЯ боевая сборка на раме класса 3: маскировка, «Клинок» третьего класса, пилоны с
 * ракетами. На старте этого железа нет, но это
 * эталон для тестов боя, маскировки и ракет — им нужно железо, которого у новичка нет.
 */
export function auroraVeteranLoadout(): Loadout {
  return createLoadout(
    // Рама класса 3 с пилонами и аукс-слотом — теперь это «Гермес» («Ника» стала стартовой, класса 2).
    HERMES,
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_STANDARD, ARMOUR_PLATE, CARGO_LARGE, HYPERDRIVE_BASIC, CLOAK_FIELD],
    [BURST_LASER, BEAM_LASER_HEAVY, PULSE_LASER_CENTRAL, MISSILE_PYLON, MISSILE_PYLON],
  )
}

/** Рядовой пират на лёгком «Икаре»: слабее игрока по железу, опасен числом. */
export function pirateLoadout(): Loadout {
  return createLoadout(
    // РЭБ в аукс-слоте: пират глушит налетающие ракеты, как и раньше (теперь это модуль,
    // а не врождённая способность — гейт в step одинаков для игрока и бота). «Гермес» —
    // тяжёлый военный корабль, рядовому пирату не по карману.
    ICARUS,
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
    // «Орион» — три орудийные точки и два пилона: ствол + две ракеты на ПИЛОНАХ (оружие — по
    // номерам точек). Компактный привод для ПОБЕГА.
    [PULSE_LASER, null, null, MISSILE_PYLON, MISSILE_PYLON],
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

/** «Ника» — серийный корпус на верфи. Середина класса 2, не «Стриж» и не «Керамет». */
export function auroraOneLoadout(): Loadout {
  return createLoadout(
    AURORA_ONE,
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_STANDARD_B, ARMOUR_COMPOSITE, CARGO_SMALL, HYPERDRIVE_LONG],
    [BURST_LASER, BURST_LASER, null, MISSILE_HEAVY, MISSILE_HEAVY],
  )
}

/**
 * Заводская сборка — начальный или средний грейд СВОЕГО класса рамы, никогда буква A.
 * Вершины («Военный» 3A, «Бастион», «Клинок», «Дальний») остаются покупкой. Стволы
 * класса 3 в каталоге и есть эти вершины, поэтому с завода стоит импульсный 2.
 * Оружие — по номерам точек: три орудия, затем два пилона.
 */
/** «Икар» — низ класса 2: сталь 2D и тяжёлый «Тягач», не середина. */
export function icarusLoadout(): Loadout {
  return createLoadout(
    ICARUS,
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_CIVILIAN_2, ARMOUR_STEEL_2, CARGO_SMALL, HYPERDRIVE_HAULER],
    [BURST_LASER, null, null, MISSILE_HEAVY, null],
  )
}
/** «Тесей» — та же середина класса 2, что у «Ники»: стандарт, композит, «Меридиан». */
export function theseusLoadout(): Loadout {
  return createLoadout(
    THESEUS,
    [ENGINE_STANDARD, RCS_STANDARD, SHIELD_STANDARD_B, ARMOUR_COMPOSITE, CARGO_SMALL, HYPERDRIVE_LONG],
    [BURST_LASER, BURST_LASER, null, MISSILE_HEAVY, MISSILE_HEAVY],
  )
}
/** «Пегас» — вход класса 3: грейд C и «Тягач» 3E, не 3A. */
export function pegasusLoadout(): Loadout {
  return createLoadout(
    PEGASUS,
    [ENGINE_MILITARY_C, RCS_MILITARY_C, SHIELD_HEAVY_C, ARMOUR_STEEL_3, CARGO_LARGE, HYPERDRIVE_HAULER_B],
    [BURST_LASER, BURST_LASER, null, MISSILE_HEAVY, MISSILE_HEAVY],
  )
}
/** «Персей» — тот же грейд C. Средняя точка пустая: своё встаёт рядом, не вместо штатного. */
export function perseusLoadout(): Loadout {
  return createLoadout(
    PERSEUS,
    [ENGINE_MILITARY_C, RCS_MILITARY_C, SHIELD_HEAVY_C, ARMOUR_STEEL_3, CARGO_SMALL, HYPERDRIVE_HAULER_B],
    [BURST_LASER, null, BURST_LASER, MISSILE_HEAVY, MISSILE_HEAVY],
  )
}
/** «Афина» — грейд C, три ствола. */
export function athenaLoadout(): Loadout {
  return createLoadout(
    ATHENA,
    [ENGINE_MILITARY_C, RCS_MILITARY_C, SHIELD_HEAVY_C, ARMOUR_STEEL_3, CARGO_SMALL, HYPERDRIVE_HAULER_B],
    [BURST_LASER, BURST_LASER, BURST_LASER, MISSILE_HEAVY, MISSILE_HEAVY],
  )
}
/** «Орион» — тот же грейд C, трюм крупнее. */
export function orionLoadout(): Loadout {
  return createLoadout(
    ORION,
    [ENGINE_MILITARY_C, RCS_MILITARY_C, SHIELD_HEAVY_C, ARMOUR_STEEL_3, CARGO_LARGE, HYPERDRIVE_HAULER_B],
    [BURST_LASER, BURST_LASER, BURST_LASER, MISSILE_HEAVY, MISSILE_HEAVY],
  )
}
/** «Гермес» — грейд C в оба слота брони. «Дальний» и «Керамет» 3A на верфи не отдают. */
export function hermesLoadout(): Loadout {
  return createLoadout(
    HERMES,
    [ENGINE_MILITARY_C, RCS_MILITARY_C, SHIELD_HEAVY_C, ARMOUR_STEEL_3, ARMOUR_STEEL_3, CARGO_LARGE, HYPERDRIVE_HAULER_B],
    [BURST_LASER, BURST_LASER, BURST_LASER, MISSILE_HEAVY, MISSILE_HEAVY],
  )
}

/**
 * Каталог верфи: какие корпуса можно взять на станции и с какой сборкой. Новый корабль —
 * новая строка, а не ветка в коде (OCP): рендер знает геометрию по `chassis.id`, домен — как
 * поставить сборку. Порядок — ЛЕСТНИЦА от слабых к сильным: стрелки на верфи листают её.
 */
export interface HullOffer {
  readonly chassis: Chassis
  readonly loadout: () => Loadout
  readonly cost: number
  /**
   * Где продают: правления миров. Нет поля — на любой верфи. «Гермес» — военный корабль, его
   * отпускают только диктатуры (ближе всего к «военным» из правлений): не из общего ряда.
   */
  readonly soldBy?: readonly Government[]
}

export const SHIPYARD: readonly HullOffer[] = [
  { chassis: ICARUS, loadout: icarusLoadout, cost: ICARUS.cost },
  { chassis: AURORA_ONE, loadout: auroraOneLoadout, cost: AURORA_ONE.cost },
  { chassis: THESEUS, loadout: theseusLoadout, cost: THESEUS.cost },
  { chassis: PEGASUS, loadout: pegasusLoadout, cost: PEGASUS.cost },
  { chassis: PERSEUS, loadout: perseusLoadout, cost: PERSEUS.cost },
  { chassis: ATHENA, loadout: athenaLoadout, cost: ATHENA.cost },
  { chassis: ORION, loadout: orionLoadout, cost: ORION.cost },
  { chassis: HERMES, loadout: hermesLoadout, cost: HERMES.cost, soldBy: ['Диктатура'] },
  // «Атлас» не продаётся: это кит — корабль поколений, город (см. `TITAN`). Его шасси живёт
  // только в трафике как рейсовый грузовик (`freighterLoadout`).
  // Все корпуса теперь — загруженные GLB-модели. Процедурные (Мк III, Арес, Аполлон, Артемида,
  // Афина, Икар, Каркинос, Деметра) сняты из игры. «Каллиопа» (DRONE) корпусом не продаётся —
  // она спасательная капсула (аукс) и шасси боевого роя (`combat/drones.ts`), к верфи не относится.
]
