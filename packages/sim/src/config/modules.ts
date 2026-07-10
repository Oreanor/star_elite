import { GALAXY } from './galaxy'
import type {
  ArmourModule,
  CargoModule,
  CloakModule,
  DroneModule,
  EngineModule,
  HyperdriveModule,
  LaserModule,
  MissileModule,
  ShieldModule,
  ShipModule,
  ThrusterModule,
} from '../domain/loadout'

/**
 * Каталог модулей. Всё, что можно купить на станции или снять с обломков.
 *
 * Числа подобраны так, чтобы апгрейд был выбором, а не улучшением по всем осям:
 * мощный щит тяжёл и режет манёвренность, военные маневровые дороги и прожорливы
 * по массе, большой трюм превращает боевой корабль в мишень.
 */

// ─── Двигатели ───────────────────────────────────────────────────────────────
// Ускорение считается как THRUST / масса, поэтому тяга здесь честная, в кН.

export const ENGINE_CIVILIAN: EngineModule = {
  id: 'engine_1e',
  name: 'Двигатель 1E «Гражданский»',
  kind: 'engine',
  class: 1,
  mass: 1.4,
  cost: 0,
  salvageChance: 0.5,
  thrust: 190,
  maxSpeed: 180,
  optimalMass: 11,
  boostMult: 1.8,
  energy: 80,
  energyRegen: 5,
}

export const ENGINE_STANDARD: EngineModule = {
  id: 'engine_2c',
  name: 'Двигатель 2C «Стандарт»',
  kind: 'engine',
  class: 2,
  mass: 2.0,
  cost: 18000,
  salvageChance: 0.35,
  thrust: 260,
  maxSpeed: 220,
  optimalMass: 13,
  boostMult: 2.4,
  energy: 110,
  energyRegen: 7,
}

export const ENGINE_MILITARY: EngineModule = {
  id: 'engine_3a',
  name: 'Двигатель 3A «Военный»',
  kind: 'engine',
  class: 3,
  mass: 3.4, // тяжёлый: часть выигрыша съедает собственная масса
  cost: 76000,
  salvageChance: 0.15,
  thrust: 380,
  maxSpeed: 265,
  optimalMass: 16,
  boostMult: 2.8,
  energy: 160,
  energyRegen: 10,
}

// ─── Маневровые ──────────────────────────────────────────────────────────────
// Момент в кН·м. Угловое ускорение = момент / (масса · inertiaFactor).
//
// Скорости разворота выбраны не «на глаз». Угловая скорость линии визирования
// на цель равна ω = v⊥/d; чтобы нос успевал за целью, скорость разворота должна
// её превышать с запасом. При прежних значениях (тангаж 0.95 рад/с) бой двух
// равных кораблей не разрешался НИКОГДА: замер показал ноль кадров с открытым
// огнём за полторы минуты. Нынешние числа дают свалку на 40–50 секунд.

export const RCS_CIVILIAN: ThrusterModule = {
  id: 'rcs_1e',
  name: 'Маневровые 1E',
  kind: 'thrusters',
  class: 1,
  mass: 0.7,
  cost: 0,
  salvageChance: 0.5,
  lateralThrust: 170,
  torque: [36, 22, 98],
  maxRate: [1.12, 0.64, 2.66],
  angDamp: 1.9,
}

export const RCS_STANDARD: ThrusterModule = {
  id: 'rcs_2c',
  name: 'Маневровые 2C',
  kind: 'thrusters',
  class: 2,
  mass: 1.0,
  cost: 14000,
  salvageChance: 0.35,
  lateralThrust: 240,
  torque: [49, 31, 130],
  maxRate: [1.33, 0.77, 3.08],
  angDamp: 1.9,
}

export const RCS_MILITARY: ThrusterModule = {
  id: 'rcs_3a',
  name: 'Маневровые 3A «Военные»',
  kind: 'thrusters',
  class: 3,
  mass: 1.9,
  cost: 62000,
  salvageChance: 0.15,
  lateralThrust: 340,
  torque: [73, 46, 182],
  maxRate: [1.75, 1.0, 3.78],
  angDamp: 2.4,
}

// ─── Щиты ────────────────────────────────────────────────────────────────────

export const SHIELD_LIGHT: ShieldModule = {
  id: 'shield_1e',
  name: 'Щит 1E',
  kind: 'shield',
  class: 1,
  mass: 0.6,
  cost: 0,
  salvageChance: 0.5,
  capacity: 40,
  regen: 2.0,
  regenDelay: 5,
}

export const SHIELD_STANDARD: ShieldModule = {
  id: 'shield_2c',
  name: 'Щит 2C',
  kind: 'shield',
  class: 2,
  mass: 1.2,
  cost: 21000,
  salvageChance: 0.3,
  capacity: 100,
  regen: 4.5,
  regenDelay: 4,
}

export const SHIELD_HEAVY: ShieldModule = {
  id: 'shield_3a',
  name: 'Щит 3A «Бастион»',
  kind: 'shield',
  class: 3,
  // Вдвое тяжелее стандартного: заметно съедает манёвренность.
  mass: 2.6,
  cost: 88000,
  salvageChance: 0.12,
  capacity: 210,
  regen: 6.0,
  regenDelay: 4.5,
}

// ─── Броня ───────────────────────────────────────────────────────────────────

export const ARMOUR_PLATE: ArmourModule = {
  id: 'armour_1',
  name: 'Бронеплиты',
  kind: 'armour',
  class: 1,
  mass: 1.5,
  cost: 9000,
  salvageChance: 0.6,
  hull: 40,
}

export const ARMOUR_COMPOSITE: ArmourModule = {
  id: 'armour_2',
  name: 'Композитная броня',
  kind: 'armour',
  class: 2,
  mass: 2.2,
  cost: 34000,
  salvageChance: 0.4,
  hull: 85,
}

// ─── Лазеры ──────────────────────────────────────────────────────────────────

/**
 * Хлам с чёрного рынка. Ставится пиратам, и это единственный честный способ
 * сделать их слабее: физика, точность и живучесть у них ровно те же, что у игрока,
 * различается только железо. Урон боту НЕ режется множителем — он несёт барахло.
 */
export const PULSE_LASER_WORN: LaserModule = {
  id: 'pulse_0',
  name: 'Импульсный лазер 0 «Изношенный»',
  kind: 'laser',
  class: 1,
  mass: 0.3,
  cost: 0,
  salvageChance: 0.7,
  damage: 6,
  range: 1600,
  cooldown: 0.34,
  heatPerShot: 0.16,
  heatCool: 0.22,
}

export const PULSE_LASER: LaserModule = {
  id: 'pulse_1',
  name: 'Импульсный лазер 1',
  kind: 'laser',
  class: 1,
  mass: 0.3,
  cost: 0,
  salvageChance: 0.55,
  damage: 9,
  range: 2200,
  // 4 выстрела/с. Стояло 0.11 — это девять в секунду, темп пулемёта:
  // пара таких стволов снимала полный щит меньше чем за секунду.
  cooldown: 0.25,
  heatPerShot: 0.12,
  heatCool: 0.28,
}

export const BURST_LASER: LaserModule = {
  id: 'pulse_2',
  name: 'Импульсный лазер 2',
  kind: 'laser',
  class: 2,
  mass: 0.5,
  cost: 16000,
  salvageChance: 0.35,
  damage: 14,
  range: 2400,
  cooldown: 0.19,
  heatPerShot: 0.1,
  heatCool: 0.26,
}

export const BEAM_LASER: LaserModule = {
  id: 'beam_2',
  name: 'Лучевой лазер 2',
  kind: 'laser',
  class: 2,
  mass: 0.8,
  cost: 47000,
  salvageChance: 0.2,
  damage: 22,
  range: 2600,
  cooldown: 0.14,
  // Жрёт тепло: очередями не постреляешь, нужен ритм.
  heatPerShot: 0.11,
  heatCool: 0.24,
}

// ─── Ракеты ──────────────────────────────────────────────────────────────────
// От ракеты НЕ уворачиваются: её боковое ускорение v·ω — семьдесят g против
// шестнадцати у корабля. Ответ на ракету — ПРО и ограниченный боезапас врага,
// а не вираж. Это посчитано (scratch/missiles.ts), а не назначено.

/**
 * Подвесная ракета: один пилон — один выстрел. Боезапас не в модуле, а в числе
 * пилонов, поэтому «выпускать по одной» получается само собой, а пустая подвеска
 * сразу видна на крыле.
 *
 * Урон 130 против 80 живучести «Сайдвиндера»: попала — значит сбила. Цена —
 * конечность боезапаса и то, что цель от неё уворачивается.
 */
export const MISSILE_PYLON: MissileModule = {
  id: 'missile_p',
  name: 'Ракета «Шершень»',
  kind: 'missile',
  class: 1,
  mass: 0.35,
  cost: 3500,
  salvageChance: 0.35,
  /** Две на пилон. У «Кобры» четыре пилона — значит восемь ракет на вылет. */
  ammo: 2,
  damage: 130,
  /**
   * Замер (`scratch/missiles.ts`): с пропорциональным наведением 550 м/с дают
   * 4 попадания из 4 по вертящейся цели с любой дистанции, а 420 — только 3 из 4.
   * Быстрая ракета не «сильнее»: она просто меньше времени даёт на ошибку.
   */
  speed: 550,
  /** Отход от носителя. Рули молчат только эти доли секунды, не весь разгон. */
  armTime: 0.18,
  boostTime: 0.55,
  turnRate: 1.25,
  /**
   * Вдвое быстрее планера. Срыв наступает при v⊥/d > 2.5, то есть у самого носа
   * ракеты: на 50 м нужен рывок вбок за 125 м/с. Прямому полёту это не грозит
   * никогда — у него v⊥ = 0.
   */
  seekerRate: 2.5,
  lifetime: 12,
}

export const MISSILE_HOMING: MissileModule = {
  id: 'missile_1',
  name: 'Ракета «Искатель»',
  kind: 'missile',
  class: 1,
  mass: 0.9,
  cost: 12000,
  salvageChance: 0.3,
  ammo: 6,
  damage: 55,
  speed: 500,
  armTime: 0.15,
  boostTime: 0.5,
  turnRate: 1.1,
  /** Головка получше подвесной — почти втрое быстрее планера: сорвать её тяжело. */
  seekerRate: 3.0,
  lifetime: 12,
}

export const MISSILE_HEAVY: MissileModule = {
  id: 'missile_2',
  name: 'Ракета «Молот»',
  kind: 'missile',
  class: 2,
  mass: 1.6,
  cost: 39000,
  salvageChance: 0.18,
  ammo: 4,
  damage: 110,
  speed: 420,
  /** Тяжёлой нужно дольше отходить от пилона. */
  armTime: 0.25,
  boostTime: 0.7,
  turnRate: 0.85,
  /** Тяжёлая и инертная: головка едва обгоняет планер, сбить её легче всех. */
  seekerRate: 1.4,
  lifetime: 14,
}

// ─── Трюм ────────────────────────────────────────────────────────────────────

export const CARGO_SMALL: CargoModule = {
  id: 'cargo_1',
  name: 'Грузовой контейнер 1',
  kind: 'cargo',
  class: 1,
  mass: 0.4,
  cost: 2000,
  salvageChance: 0.7,
  capacity: 4,
}

export const CARGO_MEDIUM: CargoModule = {
  id: 'cargo_2',
  name: 'Грузовой контейнер 2',
  kind: 'cargo',
  class: 2,
  mass: 0.8,
  cost: 6500,
  salvageChance: 0.6,
  capacity: 9,
}

export const CARGO_LARGE: CargoModule = {
  id: 'cargo_3',
  name: 'Грузовой контейнер 3',
  kind: 'cargo',
  class: 3,
  mass: 1.5,
  cost: 17000,
  salvageChance: 0.5,
  // «Кобра» — прежде всего торговец: с одним таким отсеком её трюм тянет полсотни
  // тонн, иначе рейс с товаром не окупает даже топлива, а рынок остаётся витриной.
  capacity: 50,
}


// ─── Гипердвигатели ──────────────────────────────────────────────────────────
//
// Межзвёздный перелёт невозможен без привода: без него карта галактики — атлас,
// а не маршрут. Дальность стоит дорого и в кредитах, и в массе: тяжёлый привод
// режет и ускорение, и разворот, ровно как тяжёлый щит.
//
// Дальность базового равна GALAXY.BASE_JUMP_RANGE — не совпадение, а определение:
// именно от неё считался средний шаг между звёздами при расстановке диска.

export const HYPERDRIVE_BASIC: HyperdriveModule = {
  id: 'hyper_1',
  name: 'Гиперпривод 1E «Аркан»',
  kind: 'hyperdrive',
  class: 1,
  // Полторы тонны: заметно, но с ним и взлетают. Стоит как половина корабля.
  mass: 1.6,
  cost: 45000,
  salvageChance: 0.2,
  jumpRange: GALAXY.BASE_JUMP_RANGE,
}

export const HYPERDRIVE_LONG: HyperdriveModule = {
  id: 'hyper_2',
  name: 'Гиперпривод 2C «Меридиан»',
  kind: 'hyperdrive',
  class: 2,
  mass: 2.8,
  cost: 155000,
  salvageChance: 0.12,
  jumpRange: 48,
}

export const HYPERDRIVE_DEEP: HyperdriveModule = {
  id: 'hyper_3',
  name: 'Гиперпривод 3A «Дальний»',
  kind: 'hyperdrive',
  class: 3,
  /** Пять тонн на восьмитонной «Кобре». Дальний рейс покупается манёвренностью. */
  mass: 5.0,
  cost: 420000,
  salvageChance: 0.06,
  jumpRange: 84,
}

// ─── Беспилотники ────────────────────────────────────────────────────────────

/**
 * Ствол беспилотника. Слабее изношенного пиратского: аппарат берёт не уроном.
 *
 * Урон 3 против сорока живучести «Сайдвиндера» — минимум четырнадцать попаданий.
 * Четверо за минуту пирата не убьют, и не должны: их дело — заставить его
 * вертеться, пока стреляет игрок.
 */
export const DRONE_LASER: LaserModule = {
  id: 'drone_gun',
  name: 'Лазер БПЛА',
  kind: 'laser',
  class: 1,
  mass: 0.05,
  cost: 0,
  // Сгорает вместе с аппаратом: снимать с обломка нечего.
  salvageChance: 0,
  damage: 3,
  range: 1200,
  cooldown: 0.4,
  heatPerShot: 0.05,
  heatCool: 0.4,
}

/**
 * Пусковой контейнер. Четыре аппарата в контейнере и четыре же в воздухе:
 * потолок одновременных совпадает с боезапасом не случайно — контейнер один,
 * и выпустить пятого просто нечем.
 */
export const DRONE_BAY: DroneModule = {
  id: 'drone_bay',
  name: 'Контейнер БПЛА «Рой»',
  kind: 'drone',
  class: 1,
  mass: 0.9,
  cost: 38000,
  salvageChance: 0.25,
  ammo: 4,
  /** Минута. Хватает на один бой и мало, чтобы жить в системе. */
  lifetime: 60,
  maxActive: 4,
}

// ────────────────────────────── Маскировка ───────────────────────────────
//
// Расход считан от батарей, а не назначен: у стандартного двигателя ёмкость 110
// и восполнение 7 ед/с. Расход 15 ед/с даёт чистые 8 ед/с убыли, то есть около
// четырнадцати секунд под полем с полных батарей — ровно чтобы разорвать
// контакт и уйти, но не чтобы жить в невидимости.
//
// Поле не оружие: под ним не стреляют (см. `domain/combat/cloak.ts`). Иначе
// маскировка перестала бы быть побегом и стала бы безнаказанностью.

export const CLOAK_FIELD: CloakModule = {
  id: 'cloak_1',
  name: 'Маскировочное поле «Вуаль»',
  kind: 'cloak',
  class: 3,
  /** Тяжелее гиперпривода: невидимость оплачивается манёвром, как и всё остальное. */
  mass: 6.5,
  cost: 260000,
  /** С обломка почти не снимается: сгорает вместе с кораблём, который прятал. */
  salvageChance: 0.04,
  drain: 15,
}

export const MODULE_CATALOGUE: readonly ShipModule[] = [
  ENGINE_CIVILIAN, ENGINE_STANDARD, ENGINE_MILITARY,
  RCS_CIVILIAN, RCS_STANDARD, RCS_MILITARY,
  SHIELD_LIGHT, SHIELD_STANDARD, SHIELD_HEAVY,
  ARMOUR_PLATE, ARMOUR_COMPOSITE,
  PULSE_LASER_WORN, PULSE_LASER, BURST_LASER, BEAM_LASER,
  MISSILE_PYLON, MISSILE_HOMING, MISSILE_HEAVY,
  CARGO_SMALL, CARGO_MEDIUM, CARGO_LARGE,
  HYPERDRIVE_BASIC, HYPERDRIVE_LONG, HYPERDRIVE_DEEP,
  CLOAK_FIELD, DRONE_BAY,
]

export function findModule(id: string): ShipModule | null {
  return MODULE_CATALOGUE.find((m) => m.id === id) ?? null
}
