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

// «Гражданский» — бюджетная линия: дёшева, но за тягу платит собственной массой.
// 1D тяжелее и прожорливее вольного 1E, зато первый платный шаг стоит копейки —
// это апгрейд для того, у кого ещё нет денег на «Стандарт».
export const ENGINE_CIVILIAN_D: EngineModule = {
  id: 'engine_1d',
  name: 'Двигатель 1D «Гражданский»',
  kind: 'engine',
  class: 1,
  mass: 1.7, // тяжелее 1E: дешевизна оплачена массой
  cost: 6500,
  salvageChance: 0.5,
  thrust: 215,
  maxSpeed: 195,
  optimalMass: 12,
  boostMult: 2.0,
  energy: 90,
  energyRegen: 6,
}

// «Стандарт» — рабочая лошадка. 2B поверх стокового 2C: больше тяги, но и массы,
// и цены. Прямой, честный шаг вверх без фокусов, за него платят и тонной, и кредитами.
export const ENGINE_STANDARD_B: EngineModule = {
  id: 'engine_2b',
  name: 'Двигатель 2B «Стандарт»',
  kind: 'engine',
  class: 2,
  mass: 2.4,
  cost: 34000,
  salvageChance: 0.3,
  thrust: 300,
  maxSpeed: 240,
  optimalMass: 14,
  boostMult: 2.5,
  energy: 130,
  energyRegen: 8,
}

// «Стриж» — лёгкая дорогая линия. Тяги в ней НЕ больше, чем у соседей по классу,
// но масса меньше — а ускорение это тяга/масса, значит разгон и разворот выигрывают.
// Расплата ровно одна и крупная: цена. Лёгкое и резвое всегда стоит дорого.
export const ENGINE_SWIFT: EngineModule = {
  id: 'engine_2a',
  name: 'Двигатель 2A «Стриж»',
  kind: 'engine',
  class: 2,
  mass: 1.7, // легче даже стокового 2C — в этом весь смысл линии
  cost: 52000,
  salvageChance: 0.25,
  thrust: 290,
  maxSpeed: 245,
  optimalMass: 14,
  boostMult: 2.6,
  energy: 120,
  energyRegen: 8,
}

export const ENGINE_SWIFT_B: EngineModule = {
  id: 'engine_3b',
  name: 'Двигатель 3B «Стриж»',
  kind: 'engine',
  class: 3,
  // Легче военного 3A (3.4), но не легче собственного младшего 2A: старший класс —
  // более крупное железо. Премиальность линии оплачивается ценой, а не нарушением массы.
  mass: 2.9,
  cost: 124000,
  salvageChance: 0.1,
  thrust: 360,
  maxSpeed: 270,
  optimalMass: 15,
  boostMult: 2.9,
  energy: 150,
  energyRegen: 10,
}

// «Военный» — предельная тяга, тяжёлая и дорогая. 3C — входной военный: сырой тяги
// в нём меньше, чем в топовом 3A, зато и цена, и масса ниже. Внутри линии старший
// грейд и тяжелее, и мощнее, и дороже — тяга не бывает бесплатной.
export const ENGINE_MILITARY_C: EngineModule = {
  id: 'engine_3c',
  name: 'Двигатель 3C «Военный»',
  kind: 'engine',
  class: 3,
  mass: 3.2,
  cost: 54000,
  salvageChance: 0.18,
  thrust: 340,
  maxSpeed: 250,
  optimalMass: 15,
  boostMult: 2.6,
  energy: 145,
  energyRegen: 9,
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

// «Гражданский» — бюджет. 1D сильнее вольного 1E по моменту, но тяжелее и уже за
// деньги: первый шаг к сносному развороту для того, кто ещё не накопил на класс 2.
export const RCS_CIVILIAN_D: ThrusterModule = {
  id: 'rcs_1d',
  name: 'Маневровые 1D «Гражданский»',
  kind: 'thrusters',
  class: 1,
  mass: 0.85,
  cost: 5500,
  salvageChance: 0.5,
  lateralThrust: 195,
  torque: [41, 26, 110],
  maxRate: [1.2, 0.7, 2.8],
  angDamp: 1.9,
}

// «Стандарт» — рабочая лошадка. 2B поверх 2C: момент выше, но и масса, и цена.
export const RCS_STANDARD_B: ThrusterModule = {
  id: 'rcs_2b',
  name: 'Маневровые 2B «Стандарт»',
  kind: 'thrusters',
  class: 2,
  mass: 1.25,
  cost: 30000,
  salvageChance: 0.3,
  lateralThrust: 275,
  torque: [57, 36, 150],
  maxRate: [1.45, 0.85, 3.3],
  angDamp: 2.0,
}

// «Вихрь» — лёгкая дорогая линия для верткого боя. Момент выше стандартного при
// МЕНЬШЕЙ массе — а угловое ускорение это момент/инерция, значит нос ходит резче.
// Лимит угловой скорости всё равно ниже военного потолка: перекрутить игрока
// нельзя ничем, иначе свалка перестанет разрешаться. Платят за «Вихрь» ценой.
export const RCS_VORTEX: ThrusterModule = {
  id: 'rcs_2a',
  name: 'Маневровые 2A «Вихрь»',
  kind: 'thrusters',
  class: 2,
  mass: 0.8, // легче стокового 2C — в этом весь смысл
  cost: 46000,
  salvageChance: 0.25,
  lateralThrust: 260,
  torque: [54, 34, 142],
  maxRate: [1.5, 0.88, 3.4],
  angDamp: 2.1,
}

export const RCS_VORTEX_B: ThrusterModule = {
  id: 'rcs_3b',
  name: 'Маневровые 3B «Вихрь»',
  kind: 'thrusters',
  class: 3,
  mass: 1.5, // легче военных 3C/3A, оттого и вертче при том же классе
  cost: 108000,
  salvageChance: 0.1,
  lateralThrust: 320,
  // Момент почти военный, но лимиты угловой скорости НИЖЕ 3A: потолок держит бой.
  torque: [68, 43, 172],
  maxRate: [1.68, 0.96, 3.66],
  angDamp: 2.3,
}

// «Военные» — предельный момент, тяжёлые и дорогие. 3C — входной: слабее топового
// 3A и по моменту, и по лимитам, зато легче и вдвое дешевле. Старший грейд тяжелее.
export const RCS_MILITARY_C: ThrusterModule = {
  id: 'rcs_3c',
  name: 'Маневровые 3C «Военные»',
  kind: 'thrusters',
  class: 3,
  mass: 1.7,
  cost: 48000,
  salvageChance: 0.18,
  lateralThrust: 310,
  torque: [64, 40, 164],
  maxRate: [1.58, 0.9, 3.5],
  angDamp: 2.2,
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
  capacity: 80,
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
  capacity: 120,
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

// Бюджетная линия щитов. 1D сильнее вольного 1E, но тяжелее и уже за деньги —
// первый доступный шаг, пока не по карману класс 2.
export const SHIELD_LIGHT_D: ShieldModule = {
  id: 'shield_1d',
  name: 'Щит 1D',
  kind: 'shield',
  class: 1,
  mass: 0.85,
  cost: 8000,
  salvageChance: 0.5,
  capacity: 90,
  regen: 2.6,
  regenDelay: 4.8,
}

// «Стандарт» — рабочая лошадка. 2B поверх 2C: больше ёмкости, но и массы, и цены.
export const SHIELD_STANDARD_B: ShieldModule = {
  id: 'shield_2b',
  name: 'Щит 2B',
  kind: 'shield',
  class: 2,
  mass: 1.6,
  cost: 40000,
  salvageChance: 0.28,
  capacity: 135,
  regen: 5.2,
  regenDelay: 3.8,
}

// «Мираж» — лёгкий, быстро восстанавливающийся, дорогой. Сырой ёмкости в нём НЕ
// больше, чем у соседа по классу, но регенерация выше, пауза короче, а масса мала:
// щит стычки, который отходит между заходами. Платят за это ценой, не защитой.
export const SHIELD_MIRAGE: ShieldModule = {
  id: 'shield_2a',
  name: 'Щит 2A «Мираж»',
  kind: 'shield',
  class: 2,
  mass: 0.9, // легче стокового 2C
  cost: 52000,
  salvageChance: 0.22,
  capacity: 95, // чуть меньше 2C: линия берёт не ёмкостью
  regen: 6.5, // зато отходит вдвое быстрее
  regenDelay: 3.0,
}

export const SHIELD_MIRAGE_B: ShieldModule = {
  id: 'shield_3b',
  name: 'Щит 3B «Мираж»',
  kind: 'shield',
  class: 3,
  mass: 1.9, // легче «Бастиона», оттого и манёвр щадит
  cost: 130000,
  salvageChance: 0.1,
  capacity: 170, // ёмкости меньше топового «Бастиона»
  regen: 9.0, // но регенерация лучшая в каталоге
  regenDelay: 3.2,
}

// «Бастион» — тяжёлая ёмкая стена. 3C — входной: ёмкости меньше топового 3A, зато
// легче и дешевле. Старший грейд и тяжелее, и ёмче, и дороже — защита не даром.
export const SHIELD_HEAVY_C: ShieldModule = {
  id: 'shield_3c',
  name: 'Щит 3C «Бастион»',
  kind: 'shield',
  class: 3,
  mass: 2.3,
  cost: 60000,
  salvageChance: 0.15,
  capacity: 160,
  regen: 5.0,
  regenDelay: 4.6,
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

// «Сталь» — дешёвый мясистый прокат: прочности за кредит много, но масса зверская.
// «Бронеплиты» выше — её младший грейд. 2D и 3C дают корпуса больше композита за
// меньшие деньги, и вся разница уходит в тонны — а тонны это потерянный манёвр.
export const ARMOUR_STEEL_2: ArmourModule = {
  id: 'armour_2d',
  name: 'Броня 2D «Сталь»',
  kind: 'armour',
  class: 2,
  mass: 3.2, // тяжелее композита в полтора раза
  cost: 22000, // и заметно дешевле его
  salvageChance: 0.45,
  hull: 110,
}

export const ARMOUR_STEEL_3: ArmourModule = {
  id: 'armour_3c',
  name: 'Броня 3C «Сталь»',
  kind: 'armour',
  class: 3,
  mass: 4.5, // самый прочный корпус в каталоге и самый тяжёлый
  cost: 55000,
  salvageChance: 0.2,
  hull: 180,
}

// «Композит» — сбалансированная середина. 2B поверх стокового композита: чуть
// больше корпуса за чуть больше массы и цены. Ни легковес, ни мясо — ровно между.
export const ARMOUR_COMPOSITE_B: ArmourModule = {
  id: 'armour_2b',
  name: 'Броня 2B «Композит»',
  kind: 'armour',
  class: 2,
  mass: 2.5,
  cost: 48000,
  salvageChance: 0.35,
  hull: 105,
}

// «Керамет» — лёгкая дорогая линия. Прочности на тонну больше, чем у стали, но и
// цена другая: корпус для тех, кому нельзя терять манёвр. Платят кредитами, не массой.
export const ARMOUR_CERAMET_1: ArmourModule = {
  id: 'armour_1c',
  name: 'Броня 1C «Керамет»',
  kind: 'armour',
  class: 1,
  mass: 1.3, // легче «Бронеплит» при большем корпусе
  cost: 24000,
  salvageChance: 0.45,
  hull: 55,
}

export const ARMOUR_CERAMET_2: ArmourModule = {
  id: 'armour_2a',
  name: 'Броня 2A «Керамет»',
  kind: 'armour',
  class: 2,
  mass: 1.9, // легче даже стокового композита
  cost: 52000,
  salvageChance: 0.3,
  hull: 100,
}

export const ARMOUR_CERAMET_3: ArmourModule = {
  id: 'armour_3a',
  name: 'Броня 3A «Керамет»',
  kind: 'armour',
  class: 3,
  mass: 2.6, // вдвое легче стального 3C при корпусе лишь немногим меньше
  cost: 78000,
  salvageChance: 0.15,
  hull: 150,
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

// «Импульсный» — холодная надёжная линия. 1A поверх вольного «Импульсного 1»:
// урона чуть больше, тепла меньше, но уже за деньги. Всё ещё скромнее «Импульсного 2».
export const PULSE_LASER_FINE: LaserModule = {
  id: 'pulse_1a',
  name: 'Импульсный лазер 1A',
  kind: 'laser',
  class: 1,
  mass: 0.35,
  cost: 7000,
  salvageChance: 0.5,
  damage: 11,
  range: 2300,
  cooldown: 0.24,
  heatPerShot: 0.11,
  heatCool: 0.3,
}

// «Лучевой» — большой урон за выстрел, горячий, дорогой, дальнобойный. 1-й — младший
// лучевой на класс-1 слот: бьёт сильнее импульсных, но греется и стоит дороже них.
export const BEAM_LASER_LIGHT: LaserModule = {
  id: 'beam_1',
  name: 'Лучевой лазер 1',
  kind: 'laser',
  class: 1,
  mass: 0.6,
  cost: 22000,
  salvageChance: 0.4,
  damage: 16,
  range: 2400,
  cooldown: 0.22,
  // Горячий для класса-1: длинных очередей не даёт.
  heatPerShot: 0.15,
  heatCool: 0.22,
}

// Вершина лучевой линии, класс 3 — как тяжёлая ракета, оружие будущих корпусов:
// сегодняшние орудийные слоты держат лишь класс 2, так что это витрина развитых миров.
export const BEAM_LASER_HEAVY: LaserModule = {
  id: 'beam_3',
  name: 'Лучевой лазер 3 «Клинок»',
  kind: 'laser',
  class: 3,
  mass: 1.1,
  cost: 98000,
  salvageChance: 0.14,
  damage: 30,
  range: 2800,
  cooldown: 0.13,
  // Раскаляется так, что непрерывно бить нельзя вовсе: чистый альфа-удар, не поток.
  heatPerShot: 0.13,
  heatCool: 0.22,
}

// «Роторный» — брызжет очередью: урона за выстрел мало, но темп бешеный. Берёт числом
// попаданий, а расплата двойная — короткая дальность и мгновенный перегрев. Дёшев.
export const ROTARY_LASER: LaserModule = {
  id: 'rotary_1',
  name: 'Роторный лазер 1 «Овод»',
  kind: 'laser',
  class: 1,
  mass: 0.5,
  cost: 9000,
  salvageChance: 0.4,
  damage: 5,
  range: 1400, // близкий бой: на дистанции роторный бесполезен
  cooldown: 0.1,
  // Тепла за выстрел больше, чем успевает сброситься: длинная очередь глохнет сама.
  heatPerShot: 0.14,
  heatCool: 0.3,
}

export const ROTARY_LASER_B: LaserModule = {
  id: 'rotary_2',
  name: 'Роторный лазер 2 «Шквал»',
  kind: 'laser',
  class: 2,
  mass: 0.75,
  cost: 28000,
  salvageChance: 0.3,
  damage: 7,
  range: 1600,
  cooldown: 0.08, // пиковый темп в каталоге — и мгновенный перегрев в уплату
  heatPerShot: 0.12,
  heatCool: 0.32,
}

// «Плазменное» — снайперская линия: удар за выстрел огромный, перезаряд долгий,
// дальность за три километра. Постоянного урона в секунду меньше, чем у лучевого, —
// оно берёт альфа-ударом и дистанцией, а не потоком. Горячее и дорогое.
export const PLASMA_GUN: LaserModule = {
  id: 'plasma_2',
  name: 'Плазменное орудие 2 «Гарпун»',
  kind: 'laser',
  class: 2,
  mass: 0.9,
  cost: 41000,
  salvageChance: 0.25,
  damage: 34, // тяжёлый одиночный удар, но раз в полсекунды
  range: 3000,
  cooldown: 0.55,
  heatPerShot: 0.3,
  heatCool: 0.2,
}

// Класс-3 вершина плазмы — витрина, как «Клинок»: под сегодняшние слоты не влезет.
export const PLASMA_GUN_HEAVY: LaserModule = {
  id: 'plasma_3',
  name: 'Плазменное орудие 3 «Таран»',
  kind: 'laser',
  class: 3,
  mass: 1.4,
  cost: 132000,
  salvageChance: 0.12,
  damage: 52,
  range: 3200,
  cooldown: 0.6,
  heatPerShot: 0.32,
  heatCool: 0.2,
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
 * Урон 60 — примерно половина живучести «Сайдвиндера» (щит 80 + корпус 40 = 120).
 * Ракета больше не сбивает с одного попадания: она сносит половину, а добивают
 * стволы. Так у боя есть длительность, у щита — видимая фаза, а у боезапаса из
 * шести ракет — вес: две ракеты на цель, не одна.
 */
export const MISSILE_PYLON: MissileModule = {
  id: 'missile_p',
  name: 'Ракета «Шершень»',
  kind: 'missile',
  class: 1,
  mass: 0.35,
  cost: 3500,
  salvageChance: 0.35,
  /** Две на пилон. У «Авроры» четыре пилона — значит восемь ракет на вылет. */
  ammo: 2,
  damage: 60,
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

// «Шершень» — прямая ударная линия на пилон: тяжёлая боевая часть, малый боезапас,
// слабая головка — от неё уворачиваются. Дёшева. «Жало» — бюджетный младший грейд,
// «Оса» — старший: боеголовка крупнее, но головка ещё хуже — большой заряд легче стряхнуть.
export const MISSILE_STING: MissileModule = {
  id: 'missile_pe',
  name: 'Ракета 1E «Жало»',
  kind: 'missile',
  class: 1,
  mass: 0.3,
  cost: 2200,
  salvageChance: 0.4,
  ammo: 2,
  damage: 100,
  speed: 540,
  armTime: 0.18,
  boostTime: 0.55,
  turnRate: 1.2,
  seekerRate: 2.4, // всё ещё сильно выше turnRate — головка ведёт, но срывается на манёвре
  lifetime: 11,
}

export const MISSILE_WASP: MissileModule = {
  id: 'missile_pa',
  name: 'Ракета 1A «Оса»',
  kind: 'missile',
  class: 1,
  mass: 0.4,
  cost: 6000,
  salvageChance: 0.32,
  ammo: 2,
  damage: 150, // крупнее «Шершня» — попала, значит наверняка сбила
  speed: 560,
  armTime: 0.18,
  boostTime: 0.55,
  turnRate: 1.2,
  seekerRate: 2.3, // но головка хуже «Шершня»: тяжёлый заряд проще стряхнуть виражом
  lifetime: 12,
}

// «Искатель» — рой самонаводящихся: много, урона в каждой мало, зато головка цепкая —
// сорвать её тяжело. «Свора» — дешёвый младший грейд, «Гончая» — старший: цепче и злее,
// но тяжелее и дороже. Прибавка стата оплачена массой и кредитами, не бесплатна.
export const MISSILE_SWARM: MissileModule = {
  id: 'missile_1e',
  name: 'Ракета 1E «Свора»',
  kind: 'missile',
  class: 1,
  mass: 0.8,
  cost: 8000,
  salvageChance: 0.32,
  ammo: 5,
  damage: 45,
  speed: 500,
  armTime: 0.15,
  boostTime: 0.5,
  turnRate: 1.05,
  seekerRate: 2.9,
  lifetime: 12,
}

export const MISSILE_HOUND: MissileModule = {
  id: 'missile_1b',
  name: 'Ракета 1B «Гончая»',
  kind: 'missile',
  class: 1,
  mass: 1.0,
  cost: 19000,
  salvageChance: 0.28,
  ammo: 6,
  damage: 65,
  speed: 500,
  armTime: 0.15,
  boostTime: 0.5,
  turnRate: 1.15,
  seekerRate: 3.2, // самая цепкая головка каталога — стряхнуть можно лишь у самого носа
  lifetime: 12,
}

// «Молот» — тяжёлая осадная линия. «Кувалда» — старший грейд: боеголовка ещё крупнее,
// но ракет меньше, планер инертнее, а головка едва обгоняет цель — сбить её легче всех.
export const MISSILE_SLEDGE: MissileModule = {
  id: 'missile_2a',
  name: 'Ракета 2A «Кувалда»',
  kind: 'missile',
  class: 2,
  mass: 1.9,
  cost: 58000,
  salvageChance: 0.14,
  ammo: 3,
  damage: 160,
  speed: 410,
  armTime: 0.28,
  boostTime: 0.75,
  turnRate: 0.8,
  seekerRate: 1.3, // выше turnRate, но едва: самая срываемая головка в каталоге
  lifetime: 15,
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
  // «Аврора» — прежде всего торговец: с одним таким отсеком её трюм тянет полсотни
  // тонн, иначе рейс с товаром не окупает даже топлива, а рынок остаётся витриной.
  capacity: 50,
}

// «Композит» — лёгкая дорогая линия трюма. Вместимости чуть больше стандартной, а
// массы меньше: отсек для боевого торговца, которому нельзя терять манёвр под грузом.
// Платят кредитами. Композитный класс-3 держит полсотни тонн вдвое легче стокового.
export const CARGO_COMPOSITE_1: CargoModule = {
  id: 'cargo_1a',
  name: 'Грузовой отсек 1A «Композит»',
  kind: 'cargo',
  class: 1,
  mass: 0.25, // легче стандартного при большей вместимости
  cost: 5000,
  salvageChance: 0.6,
  capacity: 5,
}

export const CARGO_COMPOSITE_2: CargoModule = {
  id: 'cargo_2a',
  name: 'Грузовой отсек 2A «Композит»',
  kind: 'cargo',
  class: 2,
  mass: 0.5,
  cost: 14000,
  salvageChance: 0.5,
  capacity: 11,
}

export const CARGO_COMPOSITE_3: CargoModule = {
  id: 'cargo_3a',
  name: 'Грузовой отсек 3A «Композит»',
  kind: 'cargo',
  class: 3,
  mass: 1.0, // против полутора тонн стокового класса-3
  cost: 42000,
  salvageChance: 0.4,
  capacity: 52,
}

// «Балкер» — дешёвый мясистый трюм: тонн за кредит больше всех, но масса зверская.
// Отсек для баржи, которой манёвр и так не нужен, а на боевом корпусе он гиря.
export const CARGO_BULK_2: CargoModule = {
  id: 'cargo_2h',
  name: 'Грузовой трюм 2E «Балкер»',
  kind: 'cargo',
  class: 2,
  mass: 1.4, // тяжелее стандартного класса-2 почти вдвое
  cost: 4500, // и дешевле его
  salvageChance: 0.6,
  capacity: 12,
}

export const CARGO_BULK_3: CargoModule = {
  id: 'cargo_3h',
  name: 'Грузовой трюм 3E «Балкер»',
  kind: 'cargo',
  class: 3,
  mass: 2.4, // против полутора тонн стокового — вся разница в потерянном манёвре
  cost: 12000,
  salvageChance: 0.5,
  capacity: 55,
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
  /** Пять тонн на восьмитонной «Авроре». Дальний рейс покупается манёвренностью. */
  mass: 5.0,
  cost: 420000,
  salvageChance: 0.06,
  jumpRange: 84,
}

// «Стриж» — лёгкая дорогая линия приводов. Дальность как у стандартных, но масса
// вдвое меньше: прыжок, купленный не манёвренностью, а кредитами. Для боевого пилота,
// которому тяжёлый привод режет разворот в бою больше, чем помогает в перелёте.
export const HYPERDRIVE_COMPACT: HyperdriveModule = {
  id: 'hyper_1a',
  name: 'Гиперпривод 1C «Стриж»',
  kind: 'hyperdrive',
  class: 1,
  mass: 1.1, // против полутора тонн «Аркана»
  cost: 72000,
  salvageChance: 0.18,
  jumpRange: 28,
}

export const HYPERDRIVE_COMPACT_B: HyperdriveModule = {
  id: 'hyper_2a',
  name: 'Гиперпривод 2A «Стриж»',
  kind: 'hyperdrive',
  class: 2,
  mass: 2.0, // легче «Меридиана» при той же дальности
  cost: 240000,
  salvageChance: 0.1,
  jumpRange: 50,
}

// «Тягач» — дешёвый тяжёлый привод. Дальность почти как у дорогих собратьев за
// малые деньги, но масса огромна. Для баржи это идеал: разворот ей и так не нужен,
// а на боевом корпусе такой привод — гиря, съедающая манёвр целиком.
export const HYPERDRIVE_HAULER: HyperdriveModule = {
  id: 'hyper_2h',
  name: 'Гиперпривод 2E «Тягач»',
  kind: 'hyperdrive',
  class: 2,
  mass: 3.6, // тяжелее «Меридиана»
  cost: 95000, // но заметно дешевле его
  salvageChance: 0.14,
  jumpRange: 45,
}

export const HYPERDRIVE_HAULER_B: HyperdriveModule = {
  id: 'hyper_3h',
  name: 'Гиперпривод 3E «Тягач»',
  kind: 'hyperdrive',
  class: 3,
  mass: 6.5, // против пяти тонн «Дальнего» — почти та же дальность за меньшие деньги
  cost: 300000,
  salvageChance: 0.06,
  jumpRange: 80,
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

// «Звено» — бюджетный контейнер: три аппарата, короткий срок жизни. Дешёвый способ
// заставить пирата вертеться, если на полноценный «Рой» ещё не хватает.
export const DRONE_BAY_LIGHT: DroneModule = {
  id: 'drone_bay_e',
  name: 'Контейнер БПЛА «Звено»',
  kind: 'drone',
  class: 1,
  mass: 0.7,
  cost: 22000,
  salvageChance: 0.3,
  ammo: 3,
  lifetime: 45,
  maxActive: 3,
}

// «Легион» — крупный класс-2 контейнер: шесть аппаратов, дольше в воздухе, до пяти
// сразу. Больше отвлекающего роя за большую массу и цену — тот же размен, что везде.
export const DRONE_BAY_HEAVY: DroneModule = {
  id: 'drone_bay_a',
  name: 'Контейнер БПЛА «Легион»',
  kind: 'drone',
  class: 2,
  mass: 1.4,
  cost: 78000,
  salvageChance: 0.2,
  ammo: 6,
  lifetime: 75,
  maxActive: 5,
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

// «Дымка» — бюджетное поле: дешевле «Вуали», но тяжелее и прожорливее. Расход 20
// при том же реакторе даёт секунд восемь под полем — только-только разорвать контакт.
export const CLOAK_HAZE: CloakModule = {
  id: 'cloak_1e',
  name: 'Маскировочное поле «Дымка»',
  kind: 'cloak',
  class: 3,
  mass: 7.5, // тяжелее «Вуали»
  cost: 150000, // но дешевле её
  salvageChance: 0.05,
  drain: 20, // жаднее: под ним живёшь меньше
}

// «Морок» — премиальное поле: легче и экономичнее «Вуали», но втрое дороже. Меньший
// расход растягивает невидимость секунд до двадцати. Лёгкое и мощное — значит дорогое.
export const CLOAK_SPECTRE: CloakModule = {
  id: 'cloak_2',
  name: 'Маскировочное поле «Морок»',
  kind: 'cloak',
  class: 3,
  mass: 5.5, // легче «Вуали» — манёвр щадит
  cost: 390000,
  salvageChance: 0.03,
  drain: 12, // экономичнее всех: дольше под полем
}

export const MODULE_CATALOGUE: readonly ShipModule[] = [
  ENGINE_CIVILIAN, ENGINE_CIVILIAN_D,
  ENGINE_STANDARD, ENGINE_STANDARD_B,
  ENGINE_SWIFT, ENGINE_SWIFT_B,
  ENGINE_MILITARY_C, ENGINE_MILITARY,
  RCS_CIVILIAN, RCS_CIVILIAN_D,
  RCS_STANDARD, RCS_STANDARD_B,
  RCS_VORTEX, RCS_VORTEX_B,
  RCS_MILITARY_C, RCS_MILITARY,
  SHIELD_LIGHT, SHIELD_LIGHT_D,
  SHIELD_STANDARD, SHIELD_STANDARD_B,
  SHIELD_MIRAGE, SHIELD_MIRAGE_B,
  SHIELD_HEAVY_C, SHIELD_HEAVY,
  ARMOUR_PLATE, ARMOUR_STEEL_2, ARMOUR_STEEL_3,
  ARMOUR_COMPOSITE, ARMOUR_COMPOSITE_B,
  ARMOUR_CERAMET_1, ARMOUR_CERAMET_2, ARMOUR_CERAMET_3,
  PULSE_LASER_WORN, PULSE_LASER, PULSE_LASER_FINE, BURST_LASER,
  BEAM_LASER_LIGHT, BEAM_LASER, BEAM_LASER_HEAVY,
  ROTARY_LASER, ROTARY_LASER_B,
  PLASMA_GUN, PLASMA_GUN_HEAVY,
  MISSILE_STING, MISSILE_PYLON, MISSILE_WASP,
  MISSILE_SWARM, MISSILE_HOMING, MISSILE_HOUND,
  MISSILE_HEAVY, MISSILE_SLEDGE,
  CARGO_SMALL, CARGO_MEDIUM, CARGO_LARGE,
  CARGO_COMPOSITE_1, CARGO_COMPOSITE_2, CARGO_COMPOSITE_3,
  CARGO_BULK_2, CARGO_BULK_3,
  HYPERDRIVE_BASIC, HYPERDRIVE_LONG, HYPERDRIVE_DEEP,
  HYPERDRIVE_COMPACT, HYPERDRIVE_COMPACT_B,
  HYPERDRIVE_HAULER, HYPERDRIVE_HAULER_B,
  CLOAK_FIELD, CLOAK_HAZE, CLOAK_SPECTRE,
  DRONE_BAY, DRONE_BAY_LIGHT, DRONE_BAY_HEAVY,
]

export function findModule(id: string): ShipModule | null {
  return MODULE_CATALOGUE.find((m) => m.id === id) ?? null
}
