import { listPrice } from './pricing'
import { COSMIC, RAYS } from './weapons'
import { GALAXY } from './galaxy'
import type {
  ArmourModule,
  BombModule,
  CargoModule,
  CloakModule,
  DroneModule,
  EcmModule,
  EngineModule,
  HyperdriveModule,
  LaserModule,
  MielophoneModule,
  MissileModule,
  ScoopModule,
  ShieldModule,
  ShipModule,
  ThrusterModule,
} from './schema'

/**
 * Каталог модулей. Всё, что можно купить на станции или снять с обломков.
 *
 * Числа подобраны так, чтобы апгрейд был выбором, а не улучшением по всем осям:
 * мощный щит тяжёл и режет манёвренность, военные маневровые дороги и прожорливы
 * по массе, большой трюм превращает боевой корабль в мишень.
 *
 * Градация одна на весь каталог. Линейка — характер обмена (дёшево и тяжело, середина,
 * легко и дорого, максимум стата). Буква внутри класса — шаг по линейке: старше значит
 * мощнее, тяжелее и дороже. Класс рамы решает, какой потолок вообще встанет.
 */

// ─── Двигатели ───────────────────────────────────────────────────────────────
// Ускорение считается как THRUST / масса, поэтому тяга здесь честная, в кН.

export const ENGINE_CIVILIAN: EngineModule = {
  id: 'engine_1e',
  name: 'Двигатель 1E «Гражданский»',
  kind: 'engine',
  class: 1,
  mass: 1,
  cost: 0,
  salvageChance: 0.5,
  thrust: 190,
  maxSpeed: 180,
  optimalMass: 11,
  boostMult: 1.8,
  cruiseMax: 10_000,
  energy: 80,
  energyRegen: 5,
}

export const ENGINE_STANDARD: EngineModule = {
  id: 'engine_2c',
  name: 'Двигатель 2C «Стандарт»',
  kind: 'engine',
  class: 2,
  mass: 2,
  cost: 18000,
  salvageChance: 0.35,
  thrust: 312,
  maxSpeed: 220,
  optimalMass: 13,
  boostMult: 2.4,
  cruiseMax: 1_000_000,
  energy: 110,
  energyRegen: 7,
}

export const ENGINE_MILITARY: EngineModule = {
  id: 'engine_3a',
  name: 'Двигатель 3A «Военный»',
  kind: 'engine',
  class: 3,
  mass: 5, // тяжелее входного 3C: часть выигрыша съедает собственная масса
  cost: 76000,
  salvageChance: 0.15,
  thrust: 551,
  maxSpeed: 265,
  optimalMass: 16,
  boostMult: 2.8,
  cruiseMax: 40_000_000,
  energy: 160,
  energyRegen: 10,
}

// «Гражданский» — бюджетная линия: дёшева, но за тягу платит собственной массой.
// 1D тяжелее и прожорливее вольного 1E, зато первый платный шаг стоит копейки —
// это апгрейд для того, у кого ещё нет денег на «Стандарт».
const ENGINE_CIVILIAN_D: EngineModule = {
  id: 'engine_1d',
  name: 'Двигатель 1D «Гражданский»',
  kind: 'engine',
  class: 1,
  mass: 2, // тяжелее 1E: дешевизна оплачена массой
  cost: 6500,
  salvageChance: 0.5,
  thrust: 215,
  maxSpeed: 195,
  optimalMass: 12,
  boostMult: 2.0,
  cruiseMax: 20_000,
  energy: 90,
  energyRegen: 6,
}

// «Стандарт» — рабочая лошадка. 2B поверх стокового 2C: больше тяги, но и массы,
// и цены. Прямой, честный шаг вверх без фокусов, за него платят и тонной, и кредитами.
const ENGINE_STANDARD_B: EngineModule = {
  id: 'engine_2b',
  name: 'Двигатель 2B «Стандарт»',
  kind: 'engine',
  class: 2,
  mass: 3,
  cost: 34000,
  salvageChance: 0.3,
  thrust: 360,
  maxSpeed: 240,
  optimalMass: 14,
  boostMult: 2.5,
  cruiseMax: 5_000_000,
  energy: 130,
  energyRegen: 8,
}

// «Стриж» — лёгкая дорогая линия. Тяги в ней НЕ больше, чем у соседей по классу,
// но масса меньше — а ускорение это тяга/масса, значит разгон и разворот выигрывают.
// Расплата ровно одна и крупная: цена. Лёгкое и резвое всегда стоит дорого.
const ENGINE_SWIFT: EngineModule = {
  id: 'engine_2a',
  name: 'Двигатель 2A «Стриж»',
  kind: 'engine',
  class: 2,
  mass: 1, // легче стокового 2C — в этом весь смысл линии
  cost: 52000,
  salvageChance: 0.25,
  thrust: 348,
  maxSpeed: 245,
  optimalMass: 14,
  boostMult: 2.6,
  cruiseMax: 2_000_000,
  energy: 120,
  energyRegen: 8,
}

const ENGINE_SWIFT_B: EngineModule = {
  id: 'engine_3b',
  name: 'Двигатель 3B «Стриж»',
  kind: 'engine',
  class: 3,
  // Легче военного 3A, но тяжелее собственного младшего 2A: старший класс — более
  // крупное железо. Премиальность линии оплачивается ценой, а не нарушением массы.
  mass: 2,
  cost: 124000,
  salvageChance: 0.1,
  thrust: 522,
  maxSpeed: 270,
  optimalMass: 15,
  boostMult: 2.9,
  cruiseMax: 30_000_000,
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
  mass: 3,
  cost: 54000,
  salvageChance: 0.18,
  thrust: 493,
  maxSpeed: 250,
  optimalMass: 15,
  boostMult: 2.6,
  cruiseMax: 20_000_000,
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
  mass: 1,
  cost: 0,
  salvageChance: 0.5,
  lateralThrust: 170,
  torque: [36, 22, 98],
  maxRate: [1.57, 0.9, 2.66],
  angDamp: 1.9,
}

export const RCS_STANDARD: ThrusterModule = {
  id: 'rcs_2c',
  name: 'Маневровые 2C',
  kind: 'thrusters',
  class: 2,
  mass: 1,
  cost: 14000,
  salvageChance: 0.35,
  lateralThrust: 240,
  torque: [49, 31, 130],
  maxRate: [1.86, 1.08, 3.08],
  angDamp: 1.9,
}

export const RCS_MILITARY: ThrusterModule = {
  id: 'rcs_3a',
  name: 'Маневровые 3A «Военные»',
  kind: 'thrusters',
  class: 3,
  mass: 3, // старше 3C и тяжелее: потолок момента не бесплатен
  cost: 62000,
  salvageChance: 0.15,
  lateralThrust: 340,
  torque: [73, 46, 182],
  maxRate: [2.45, 1.4, 3.78],
  angDamp: 2.4,
}

// «Гражданский» — бюджет. 1D сильнее вольного 1E по моменту, но тяжелее и уже за
// деньги: первый шаг к сносному развороту для того, кто ещё не накопил на класс 2.
const RCS_CIVILIAN_D: ThrusterModule = {
  id: 'rcs_1d',
  name: 'Маневровые 1D «Гражданский»',
  kind: 'thrusters',
  class: 1,
  mass: 1,
  cost: 5500,
  salvageChance: 0.5,
  lateralThrust: 195,
  torque: [41, 26, 110],
  maxRate: [1.68, 0.98, 2.8],
  angDamp: 1.9,
}

// «Стандарт» — рабочая лошадка. 2B поверх 2C: момент выше, но и масса, и цена.
const RCS_STANDARD_B: ThrusterModule = {
  id: 'rcs_2b',
  name: 'Маневровые 2B «Стандарт»',
  kind: 'thrusters',
  class: 2,
  mass: 2,
  cost: 30000,
  salvageChance: 0.3,
  lateralThrust: 275,
  torque: [57, 36, 150],
  maxRate: [2.03, 1.19, 3.3],
  angDamp: 2.0,
}

// «Вихрь» — лёгкая дорогая линия для верткого боя. Момент выше стандартного при
// МЕНЬШЕЙ массе — а угловое ускорение это момент/инерция, значит нос ходит резче.
// Лимит угловой скорости всё равно ниже военного потолка: перекрутить игрока
// нельзя ничем, иначе свалка перестанет разрешаться. Платят за «Вихрь» ценой.
const RCS_VORTEX: ThrusterModule = {
  id: 'rcs_2a',
  name: 'Маневровые 2A «Вихрь»',
  kind: 'thrusters',
  class: 2,
  mass: 1, // легче стокового 2C — в этом весь смысл
  cost: 46000,
  salvageChance: 0.25,
  lateralThrust: 260,
  torque: [54, 34, 142],
  maxRate: [2.1, 1.23, 3.4],
  angDamp: 2.1,
}

const RCS_VORTEX_B: ThrusterModule = {
  id: 'rcs_3b',
  name: 'Маневровые 3B «Вихрь»',
  kind: 'thrusters',
  class: 3,
  mass: 2, // легче военных 3C/3A, оттого и вертче при том же классе
  cost: 108000,
  salvageChance: 0.1,
  lateralThrust: 320,
  // Момент почти военный, но лимиты угловой скорости НИЖЕ 3A: потолок держит бой.
  torque: [68, 43, 172],
  maxRate: [2.35, 1.34, 3.66],
  angDamp: 2.3,
}

// «Военные» — предельный момент, тяжёлые и дорогие. 3C — входной: слабее топового
// 3A и по моменту, и по лимитам, зато легче и вдвое дешевле. Старший грейд тяжелее.
export const RCS_MILITARY_C: ThrusterModule = {
  id: 'rcs_3c',
  name: 'Маневровые 3C «Военные»',
  kind: 'thrusters',
  class: 3,
  mass: 2,
  cost: 48000,
  salvageChance: 0.18,
  lateralThrust: 310,
  torque: [64, 40, 164],
  maxRate: [2.21, 1.26, 3.5],
  angDamp: 2.2,
}

// ─── Щиты ────────────────────────────────────────────────────────────────────

export const SHIELD_LIGHT: ShieldModule = {
  id: 'shield_1e',
  name: 'Щит 1E',
  kind: 'shield',
  class: 1,
  mass: 1,
  cost: 0,
  salvageChance: 0.5,
  capacity: 170,
  regen: 2.0,
  regenDelay: 5,
}

export const SHIELD_STANDARD: ShieldModule = {
  id: 'shield_2c',
  name: 'Щит 2C',
  kind: 'shield',
  class: 2,
  mass: 1,
  cost: 21000,
  salvageChance: 0.3,
  capacity: 325,
  regen: 5.85,
  regenDelay: 4,
}

export const SHIELD_HEAVY: ShieldModule = {
  id: 'shield_3a',
  name: 'Щит 3A «Бастион»',
  kind: 'shield',
  class: 3,
  // Вдвое тяжелее стандартного: заметно съедает манёвренность.
  mass: 3,
  cost: 88000,
  salvageChance: 0.12,
  capacity: 748,
  regen: 10.2,
  regenDelay: 4.5,
}

// Бюджетная линия щитов. 1D сильнее вольного 1E, но тяжелее и уже за деньги —
// первый доступный шаг, пока не по карману класс 2.
const SHIELD_LIGHT_D: ShieldModule = {
  id: 'shield_1d',
  name: 'Щит 1D',
  kind: 'shield',
  class: 1,
  mass: 1,
  cost: 8000,
  salvageChance: 0.5,
  capacity: 190,
  regen: 2.6,
  regenDelay: 4.8,
}

// «Стандарт» — рабочая лошадка. 2B поверх 2C: больше ёмкости, но и массы, и цены.
export const SHIELD_STANDARD_B: ShieldModule = {
  id: 'shield_2b',
  name: 'Щит 2B',
  kind: 'shield',
  class: 2,
  mass: 2,
  cost: 40000,
  salvageChance: 0.28,
  capacity: 370,
  regen: 6.76,
  regenDelay: 3.8,
}

// «Мираж» — лёгкий, быстро восстанавливающийся, дорогой. Сырой ёмкости в нём НЕ
// больше, чем у соседа по классу, но регенерация выше, пауза короче, а масса мала:
// щит стычки, который отходит между заходами. Платят за это ценой, не защитой.
const SHIELD_MIRAGE: ShieldModule = {
  id: 'shield_2a',
  name: 'Щит 2A «Мираж»',
  kind: 'shield',
  class: 2,
  mass: 1, // легче стокового 2C
  cost: 52000,
  salvageChance: 0.22,
  capacity: 260, // чуть меньше 2C: линия берёт не ёмкостью
  regen: 8.45, // зато отходит вдвое быстрее
  regenDelay: 3.0,
}

const SHIELD_MIRAGE_B: ShieldModule = {
  id: 'shield_3b',
  name: 'Щит 3B «Мираж»',
  kind: 'shield',
  class: 3,
  mass: 2, // легче «Бастиона», оттого и манёвр щадит
  cost: 130000,
  salvageChance: 0.1,
  capacity: 604, // ёмкости меньше топового «Бастиона»
  regen: 15.3, // но регенерация лучшая в каталоге
  regenDelay: 3.2,
}

// «Бастион» — тяжёлая ёмкая стена. 3C — входной: ёмкости меньше топового 3A, зато
// легче и дешевле. Старший грейд и тяжелее, и ёмче, и дороже — защита не даром.
export const SHIELD_HEAVY_C: ShieldModule = {
  id: 'shield_3c',
  name: 'Щит 3C «Бастион»',
  kind: 'shield',
  class: 3,
  mass: 2,
  cost: 60000,
  salvageChance: 0.15,
  capacity: 570,
  regen: 8.5,
  regenDelay: 4.6,
}

// ─── Броня ───────────────────────────────────────────────────────────────────

export const ARMOUR_PLATE: ArmourModule = {
  id: 'armour_1',
  name: 'Бронеплиты',
  kind: 'armour',
  class: 1,
  mass: 2,
  cost: 9000,
  salvageChance: 0.6,
  hull: 100,
}

export const ARMOUR_COMPOSITE: ArmourModule = {
  id: 'armour_2',
  name: 'Композитная броня',
  kind: 'armour',
  class: 2,
  mass: 2,
  cost: 34000,
  salvageChance: 0.4,
  hull: 273,
}

// «Сталь» — дешёвый мясистый прокат: прочности за кредит много, но масса зверская.
// «Бронеплиты» выше — её младший грейд. 2D и 3C дают корпуса больше композита за
// меньшие деньги, и вся разница уходит в тонны — а тонны это потерянный манёвр.
export const ARMOUR_STEEL_2: ArmourModule = {
  id: 'armour_2d',
  name: 'Броня 2D «Сталь»',
  kind: 'armour',
  class: 2,
  mass: 3, // тяжелее композита в полтора раза
  cost: 22000, // и заметно дешевле его
  salvageChance: 0.45,
  hull: 358,
}

export const ARMOUR_STEEL_3: ArmourModule = {
  id: 'armour_3c',
  name: 'Броня 3C «Сталь»',
  kind: 'armour',
  class: 3,
  mass: 5, // самый прочный корпус в каталоге и самый тяжёлый
  cost: 55000,
  salvageChance: 0.2,
  hull: 720,
}

// «Композит» — сбалансированная середина. 2B поверх стокового композита: чуть
// больше корпуса за чуть больше массы и цены. Ни легковес, ни мясо — ровно между.
const ARMOUR_COMPOSITE_B: ArmourModule = {
  id: 'armour_2b',
  name: 'Броня 2B «Композит»',
  kind: 'armour',
  class: 2,
  mass: 3,
  cost: 48000,
  salvageChance: 0.35,
  hull: 338,
}

// «Керамет» — лёгкая дорогая линия. Прочности на тонну больше, чем у стали, но и
// цена другая: корпус для тех, кому нельзя терять манёвр. Платят кредитами, не массой.
const ARMOUR_CERAMET_1: ArmourModule = {
  id: 'armour_1c',
  name: 'Броня 1C «Керамет»',
  kind: 'armour',
  class: 1,
  mass: 1, // легче «Бронеплит» при большем корпусе
  cost: 24000,
  salvageChance: 0.45,
  hull: 140,
}

const ARMOUR_CERAMET_2: ArmourModule = {
  id: 'armour_2a',
  name: 'Броня 2A «Керамет»',
  kind: 'armour',
  class: 2,
  mass: 2, // легче даже стокового композита
  cost: 52000,
  salvageChance: 0.3,
  hull: 325,
}

const ARMOUR_CERAMET_3: ArmourModule = {
  id: 'armour_3a',
  name: 'Броня 3A «Керамет»',
  kind: 'armour',
  class: 3,
  mass: 3, // вдвое легче стального 3C при корпусе лишь немногим меньше
  cost: 78000,
  salvageChance: 0.15,
  hull: 600,
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
  mass: 1,
  cost: 0,
  salvageChance: 0.7,
  damage: 6,
  range: 4000,
  cooldown: 0.34,
  heatPerShot: 0.16,
  heatCool: 0.22,
}

export const PULSE_LASER: LaserModule = {
  id: 'pulse_1',
  name: 'Импульсный лазер 1',
  kind: 'laser',
  class: 1,
  mass: 1,
  cost: 3000,
  salvageChance: 0.55,
  damage: 8,
  range: 4000,
  // 4 выстрела/с. Стояло 0.11 — это девять в секунду, темп пулемёта:
  // пара таких стволов снимала полный щит меньше чем за секунду.
  cooldown: 0.25,
  heatPerShot: 0.12,
  heatCool: 0.28,
}

/**
 * Центральный «Столб» — тяжёлый импульсник: бьёт ВДВОЕ реже обычного (cooldown 0.5),
 * зато вдвое больнее за выстрел — тот же секундный урон, но кучным «столбом света».
 * Класс 1 (тот же синий цвет луча), стоит по центру носа. Толщина луча — чисто визуал
 * и живёт в рендере (LASER_BEAM_SCALE по id), домену её знать незачем.
 */
export const PULSE_LASER_CENTRAL: LaserModule = {
  id: 'pulse_1c',
  name: 'Плазменный лучемёт 1 «Столб»',
  kind: 'laser',
  class: 1,
  mass: 1,
  cost: 0,
  salvageChance: 0.4,
  // НЕПРЕРЫВНЫЙ: числа секундные, а не за выстрел. Ствол — обычной силы; вдвое больнее
  // и толще его делает НОСОВАЯ ТОЧКА (её калибр), куда он и ставится, — сила у места, а
  // не у покупки. 18/с × калибр 2 = прежние 36/с, секундный урон не изменился.
  beam: true,
  damage: 40,
  range: 4000,
  cooldown: 0, // струю нечем прерывать: перезаряда у луча нет
  heatPerShot: 0.28, // за СЕКУНДУ огня (было 0.14 за импульс раз в 0.5 с)
  heatCool: 0.28,
}

/**
 * ГОРНЫЙ лазер — технический, не боевой. Лазеры по умолчанию военные: камень от них
 * рассыпается пылью и рудой. Горный же КОЛЕТ камень на осколки — так добывают: руда
 * собирается с обломков. По кораблям он слаб — инструмент, а не оружие.
 */
export const MINING_LASER: LaserModule = {
  id: 'mining_1',
  name: 'Горный лазер 1',
  kind: 'laser',
  class: 1,
  mass: 1,
  cost: 6000,
  salvageChance: 0.5,
  damage: 5,
  range: 3000,
  cooldown: 0.3,
  heatPerShot: 0.1,
  heatCool: 0.3,
  effect: 'cut',
  // Колет бережно: три четверти руды камня до трюма. Прокачка — к единице.
  oreYield: 0.75,
}

/**
 * ЛУЧИ-ДИКОВИНЫ: не жгут, а ПЕРЕДЕЛЫВАЮТ цель. Непрерывные (действуют, пока держишь цель в
 * луче), урона не несут. Уменьшающий и увеличивающий меняют размер цели (корабль, камень),
 * удерживающий гасит её ход и вращение. Не продаются: вещи редкие, не товар.
 */
export const SHRINK_RAY: LaserModule = {
  id: 'ray_shrink',
  name: 'Уменьшающий луч',
  kind: 'laser',
  class: 2,
  mass: 1,
  cost: 60000,
  notSold: true,
  salvageChance: 0,
  beam: true,
  damage: 0,
  // До предела видимости исполинов (статуя — 50 км радиусом): см. `RAYS.RANGE`.
  range: RAYS.RANGE,
  cooldown: 0,
  heatPerShot: 0.12,
  heatCool: 0.2,
  effect: 'shrink',
  // e-кратно за ~1.4 с: из 30-метрового борта в метровую точку — секунд пять в луче.
  effectRate: 0.7,
}

export const GROW_RAY: LaserModule = {
  id: 'ray_grow',
  name: 'Увеличивающий луч',
  kind: 'laser',
  class: 2,
  mass: 1,
  cost: 60000,
  notSold: true,
  salvageChance: 0,
  beam: true,
  damage: 0,
  // До предела видимости исполинов (статуя — 50 км радиусом): см. `RAYS.RANGE`.
  range: RAYS.RANGE,
  cooldown: 0,
  heatPerShot: 0.12,
  heatCool: 0.2,
  effect: 'grow',
  effectRate: 0.7,
}

export const HOLD_RAY: LaserModule = {
  id: 'ray_hold',
  name: 'Удерживающий луч',
  kind: 'laser',
  class: 2,
  mass: 1,
  cost: 60000,
  notSold: true,
  salvageChance: 0,
  beam: true,
  damage: 0,
  // До предела видимости исполинов (статуя — 50 км радиусом): см. `RAYS.RANGE`.
  range: RAYS.RANGE,
  cooldown: 0,
  heatPerShot: 0.1,
  heatCool: 0.25,
  effect: 'hold',
  // Ход гаснет вчетверо быстрее секунды: цель в луче встаёт почти сразу.
  effectRate: 4,
}

/**
 * КОСМИЧЕСКИЕ ЛАЗЕРЫ — орудия для миров (`combat/cosmic.ts`). Класс 1, чтобы встать на любой
 * корпус; не продаются и не снимаются с обломков: их итог — правка галактики для всех.
 */
export const SEED_RAY: LaserModule = {
  id: 'cosmic_seed',
  name: 'Засевающий луч',
  kind: 'laser',
  class: 1,
  mass: 1,
  cost: 500000,
  notSold: true,
  salvageChance: 0,
  beam: true,
  damage: 0,
  range: COSMIC.RANGE,
  cooldown: 0,
  // Засев — 3 с удержания (`COSMIC.SEED_TIME`): греется так, чтобы на один мир хватало с запасом.
  heatPerShot: 0.08,
  heatCool: 0.25,
  effect: 'seed',
}

export const SHATTER_CANNON: LaserModule = {
  id: 'cosmic_shatter',
  name: 'Разбивающий импульс',
  kind: 'laser',
  class: 1,
  mass: 1,
  cost: 900000,
  notSold: true,
  salvageChance: 0,
  damage: 0,
  range: COSMIC.SHATTER_RANGE,
  // Один шар — и перегрев (`fireLasers`): нагрев не долей, а на весь запас шкалы.
  cooldown: 3,
  heatPerShot: 1,
  heatCool: 0.2,
  effect: 'shatter',
}

export const BURST_LASER: LaserModule = {
  id: 'pulse_2',
  name: 'Импульсный лазер 2',
  kind: 'laser',
  class: 2,
  mass: 1,
  cost: 16000,
  salvageChance: 0.35,
  damage: 13,
  range: 4000,
  cooldown: 0.19,
  heatPerShot: 0.1,
  heatCool: 0.26,
}

export const BEAM_LASER: LaserModule = {
  id: 'beam_2',
  name: 'Лучевой лазер 2',
  kind: 'laser',
  class: 2,
  mass: 1,
  cost: 60000,
  salvageChance: 0.2,
  beam: true,
  damage: 150,
  range: 4000,
  cooldown: 0,
  // Жрёт тепло: очередями не постреляешь, нужен ритм.
  heatPerShot: 0.22,
  heatCool: 0.24,
}

// «Импульсный» — холодная надёжная линия. 1A поверх вольного «Импульсного 1»:
// урона чуть больше, тепла меньше, но уже за деньги. Всё ещё скромнее «Импульсного 2».
const PULSE_LASER_FINE: LaserModule = {
  id: 'pulse_1a',
  name: 'Импульсный лазер 1A',
  kind: 'laser',
  class: 1,
  mass: 1,
  cost: 7000,
  salvageChance: 0.5,
  damage: 10,
  range: 4000,
  cooldown: 0.24,
  heatPerShot: 0.11,
  heatCool: 0.3,
}

// ВОЕННЫЕ ЛАЗЕРЫ — четыре семейства с разным ХАРАКТЕРОМ, урон в секунду (DPS):
//  • импульсные — ровные одиночные выстрелы, как класс СЛАБЕЕ: 32–42 / 68;
//  • роторные — часто и мелко, долбят очередью: 50 / 100;
//  • плазменные — редко, тяжёлым сгустком (45 и 80 за выстрел): 50 / 80;
//  • лучевые — НЕПРЕРЫВНЫЙ луч (`beam`, урон — в секунду), как класс СИЛЬНЕЕ: 70 / 150 / 260,
//    держат их только нагревом. Плата за класс — цена: лестница в разы, есть ради чего копить.
//
// «Лучевой» 1 — младший луч на класс-1 слот.
const BEAM_LASER_LIGHT: LaserModule = {
  id: 'beam_1',
  name: 'Лучевой лазер 1',
  kind: 'laser',
  class: 1,
  mass: 1,
  cost: 22000,
  salvageChance: 0.4,
  beam: true,
  damage: 70,
  range: 4000,
  cooldown: 0,
  // Горячий для класса-1: длинных очередей не даёт.
  heatPerShot: 0.2,
  heatCool: 0.22,
}

// Вершина лучевой линии, класс 3 — как тяжёлая ракета, оружие будущих корпусов:
// сегодняшние орудийные слоты держат лишь класс 2, так что это витрина развитых миров.
export const BEAM_LASER_HEAVY: LaserModule = {
  id: 'beam_3',
  name: 'Лучевой лазер 3 «Клинок»',
  kind: 'laser',
  class: 3,
  mass: 1,
  cost: 140000,
  salvageChance: 0.14,
  beam: true,
  damage: 260,
  range: 4000,
  cooldown: 0,
  // Раскаляется так, что непрерывно бить нельзя вовсе: чистый альфа-удар, не поток.
  heatPerShot: 0.25,
  heatCool: 0.22,
}

// «Роторный» — брызжет очередью: урона за выстрел мало, но темп бешеный. Берёт числом
// попаданий, а расплата двойная — короткая дальность и мгновенный перегрев. Дёшев.
const ROTARY_LASER: LaserModule = {
  id: 'rotary_1',
  name: 'Роторный лазер 1 «Овод»',
  kind: 'laser',
  class: 1,
  mass: 1,
  cost: 9000,
  salvageChance: 0.4,
  damage: 4,
  range: 4000, // близкий бой: на дистанции роторный бесполезен
  cooldown: 0.08,
  // Тепла за выстрел больше, чем успевает сброситься: длинная очередь глохнет сама.
  heatPerShot: 0.14,
  heatCool: 0.3,
}

const ROTARY_LASER_B: LaserModule = {
  id: 'rotary_2',
  name: 'Роторный лазер 2 «Шквал»',
  kind: 'laser',
  class: 2,
  mass: 1,
  cost: 30000,
  salvageChance: 0.3,
  damage: 6,
  range: 4000,
  cooldown: 0.06, // пиковый темп в каталоге — и мгновенный перегрев в уплату
  heatPerShot: 0.12,
  heatCool: 0.32,
}

// «Плазменное» — снайперская линия: удар за выстрел огромный, перезаряд долгий,
// дальность за три километра. Постоянного урона в секунду меньше, чем у лучевого, —
// оно берёт альфа-ударом и дистанцией, а не потоком. Горячее и дорогое.
const PLASMA_GUN: LaserModule = {
  id: 'plasma_2',
  name: 'Плазменное орудие 2 «Гарпун»',
  kind: 'laser',
  class: 2,
  mass: 1,
  cost: 30000,
  salvageChance: 0.25,
  damage: 45, // тяжёлый одиночный удар, но раз в полсекунды
  range: 4000,
  cooldown: 0.9,
  heatPerShot: 0.3,
  heatCool: 0.2,
}

// Класс-3 вершина плазмы — витрина, как «Клинок»: под сегодняшние слоты не влезет.
const PLASMA_GUN_HEAVY: LaserModule = {
  id: 'plasma_3',
  name: 'Плазменное орудие 3 «Таран»',
  kind: 'laser',
  class: 3,
  mass: 1,
  cost: 90000,
  salvageChance: 0.12,
  damage: 80,
  range: 4000,
  cooldown: 1.0,
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
 * Урон 200 — примерно 3/4 живучести «Сайдвиндера» (щит 170 + корпус 100 = 270),
 * а у среднего борта — около половины. Ракета больше не сбивает с одного попадания:
 * она сносит крупный кусок, а добивают стволы. Так у боя есть длительность, у щита —
 * видимая фаза, а у боезапаса из шести ракет — вес: две ракеты на цель, не одна.
 */
export const MISSILE_PYLON: MissileModule = {
  id: 'missile_p',
  name: 'Ракета «Шершень»',
  kind: 'missile',
  class: 1,
  // Рельс. Сами ракеты — тонна штука в трюме, не в массе модуля.
  mass: 2,
  cost: 3500,
  salvageChance: 0.35,
  /** Сколько штук кладут с завода на этот пилон. Потолок покупки — грузовой отсек, не это число. */
  ammo: 2,
  damage: 200,
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

const MISSILE_HOMING: MissileModule = {
  id: 'missile_1',
  name: 'Ракета «Искатель»',
  kind: 'missile',
  class: 1,
  mass: 1,
  cost: 12000,
  salvageChance: 0.3,
  ammo: 6,
  damage: 185,
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
  mass: 2,
  cost: 39000,
  salvageChance: 0.18,
  ammo: 4,
  damage: 365,
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
const MISSILE_STING: MissileModule = {
  id: 'missile_pe',
  name: 'Ракета 1E «Жало»',
  kind: 'missile',
  class: 1,
  mass: 1,
  cost: 2200,
  salvageChance: 0.4,
  ammo: 2,
  damage: 330,
  speed: 540,
  armTime: 0.18,
  boostTime: 0.55,
  turnRate: 1.2,
  seekerRate: 2.4, // всё ещё сильно выше turnRate — головка ведёт, но срывается на манёвре
  lifetime: 11,
}

const MISSILE_WASP: MissileModule = {
  id: 'missile_pa',
  name: 'Ракета 1A «Оса»',
  kind: 'missile',
  class: 1,
  mass: 1,
  cost: 6000,
  salvageChance: 0.32,
  ammo: 2,
  damage: 500, // крупнее «Шершня» — попала, значит наверняка сбила
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
const MISSILE_SWARM: MissileModule = {
  id: 'missile_1e',
  name: 'Ракета 1E «Свора»',
  kind: 'missile',
  class: 1,
  mass: 1,
  cost: 8000,
  salvageChance: 0.32,
  ammo: 5,
  damage: 150,
  speed: 500,
  armTime: 0.15,
  boostTime: 0.5,
  turnRate: 1.05,
  seekerRate: 2.9,
  lifetime: 12,
}

const MISSILE_HOUND: MissileModule = {
  id: 'missile_1b',
  name: 'Ракета 1B «Гончая»',
  kind: 'missile',
  class: 1,
  mass: 1,
  cost: 19000,
  salvageChance: 0.28,
  ammo: 6,
  damage: 215,
  speed: 500,
  armTime: 0.15,
  boostTime: 0.5,
  turnRate: 1.15,
  seekerRate: 3.2, // самая цепкая головка каталога — стряхнуть можно лишь у самого носа
  lifetime: 12,
}

// «Молот» — тяжёлая осадная линия. «Кувалда» — старший грейд: боеголовка ещё крупнее,
// но ракет меньше, планер инертнее, а головка едва обгоняет цель — сбить её легче всех.
const MISSILE_SLEDGE: MissileModule = {
  id: 'missile_2a',
  name: 'Ракета 2A «Кувалда»',
  kind: 'missile',
  class: 2,
  mass: 2,
  cost: 58000,
  salvageChance: 0.14,
  ammo: 3,
  damage: 530,
  speed: 410,
  armTime: 0.28,
  boostTime: 0.75,
  turnRate: 0.8,
  seekerRate: 1.3, // выше turnRate, но едва: самая срываемая головка в каталоге
  lifetime: 15,
}

// ПРЕДЕЛЫ РАЗВОРОТА маневровых: тангаж и рыскание ×1.4 против прежних — улучшение их больше
// не растит (см. `scaleToBase`), а заводские были скромны: нос поворачивал вяло. Крен — прежний.
//
// ЛЕСТНИЦА КЛАССОВ. Щиты, броня и двигатели 2-го и 3-го класса усилены против 1-го
// (щит ×1.3/×1.7, броня ×1.3/×1.6, тяга ×1.2/×1.45): прежде
// класс 3 был лишь на 10–40% сильнее первого при цене в 5–15 раз — копить было не на что.
// Потолок скорости двигателей не трогали: темп боя держится им, а не тягой. Маневровые —
// тоже: резче разворот = вертлявее нос, а наводиться и так непросто.

// ─── Трюм ────────────────────────────────────────────────────────────────────
//
// Контейнеры БЕСКЛАССОВЫ: любой грузовой слот принимает любой. Линейка ОДНА —
// 10 / 20 / 30 / 50 / 100 т. Цена не скидка за опт, а та же формула, что у остального
// железа: сколько тонн груза приходится на тонну самого контейнера. Сам контейнер весит
// (целыми тоннами, как всё оборудование) и ест бюджет корпуса.
// (Поле `class` держим на 1, чтобы контейнер влезал в слот любого класса.)

export const CARGO_SMALL: CargoModule = {
  id: 'cargo_1',
  name: 'Грузовой контейнер 10 т',
  kind: 'cargo',
  class: 1,
  mass: 1,
  cost: 4000, // 400 кр/т
  salvageChance: 0.7,
  capacity: 10,
}

export const CARGO_MEDIUM: CargoModule = {
  id: 'cargo_2',
  name: 'Грузовой контейнер 20 т',
  kind: 'cargo',
  class: 1,
  mass: 1,
  cost: 7500, // 375 кр/т
  salvageChance: 0.6,
  capacity: 20,
}

export const CARGO_LARGE: CargoModule = {
  id: 'cargo_3',
  name: 'Грузовой контейнер 30 т',
  kind: 'cargo',
  class: 1,
  mass: 2,
  cost: 10500, // 350 кр/т
  salvageChance: 0.5,
  capacity: 30,
}

export const CARGO_HUGE: CargoModule = {
  id: 'cargo_4',
  name: 'Грузовой контейнер 50 т',
  kind: 'cargo',
  class: 1,
  mass: 3,
  cost: 16000, // 320 кр/т
  salvageChance: 0.4,
  capacity: 50,
}

export const CARGO_GIANT: CargoModule = {
  id: 'cargo_5',
  name: 'Грузовой контейнер 100 т',
  kind: 'cargo',
  class: 1,
  mass: 5,
  cost: 28000, // 280 кр/т
  salvageChance: 0.3,
  capacity: 100,
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
  mass: 2,
  cost: 45000,
  salvageChance: 0.2,
  jumpRange: GALAXY.BASE_JUMP_RANGE,
}

export const HYPERDRIVE_LONG: HyperdriveModule = {
  id: 'hyper_2',
  name: 'Гиперпривод 2C «Меридиан»',
  kind: 'hyperdrive',
  class: 2,
  mass: 3,
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
  mass: 5,
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
  mass: 1, // против полутора тонн «Аркана»
  cost: 72000,
  salvageChance: 0.18,
  jumpRange: 28,
}

const HYPERDRIVE_COMPACT_B: HyperdriveModule = {
  id: 'hyper_2a',
  name: 'Гиперпривод 2A «Стриж»',
  kind: 'hyperdrive',
  class: 2,
  mass: 2, // легче «Меридиана» при той же дальности
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
  mass: 4, // тяжелее «Меридиана»
  cost: 95000, // но заметно дешевле его
  salvageChance: 0.14,
  jumpRange: 45,
}

export const HYPERDRIVE_HAULER_B: HyperdriveModule = {
  id: 'hyper_3h',
  name: 'Гиперпривод 3E «Тягач»',
  kind: 'hyperdrive',
  class: 3,
  mass: 7, // против пяти тонн «Дальнего» — почти та же дальность за меньшие деньги
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
  range: 4000,
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
  mass: 1,
  cost: 38000,
  salvageChance: 0.25,
  ammo: 4,
  /** Минута. Хватает на один бой и мало, чтобы жить в системе. */
  lifetime: 60,
  maxActive: 4,
}

// «Звено» — бюджетный контейнер: три аппарата, короткий срок жизни. Дешёвый способ
// заставить пирата вертеться, если на полноценный «Рой» ещё не хватает.
const DRONE_BAY_LIGHT: DroneModule = {
  id: 'drone_bay_e',
  name: 'Контейнер БПЛА «Звено»',
  kind: 'drone',
  class: 1,
  mass: 1,
  cost: 22000,
  salvageChance: 0.3,
  ammo: 3,
  lifetime: 45,
  maxActive: 3,
}

// «Легион» — крупный класс-2 контейнер: шесть аппаратов, дольше в воздухе, до пяти
// сразу. Больше отвлекающего роя за большую массу и цену — тот же размен, что везде.
const DRONE_BAY_HEAVY: DroneModule = {
  id: 'drone_bay_a',
  name: 'Контейнер БПЛА «Легион»',
  kind: 'drone',
  class: 2,
  mass: 1,
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
  mass: 7,
  cost: 260000,
  /** С обломка почти не снимается: сгорает вместе с кораблём, который прятал. */
  salvageChance: 0.04,
  drain: 15,
}

// «Дымка» — бюджетное поле: дешевле «Вуали», но тяжелее и прожорливее. Расход 20
// при том же реакторе даёт секунд восемь под полем — только-только разорвать контакт.
const CLOAK_HAZE: CloakModule = {
  id: 'cloak_1e',
  name: 'Маскировочное поле «Дымка»',
  kind: 'cloak',
  class: 3,
  mass: 8, // тяжелее «Вуали»
  cost: 150000, // но дешевле её
  salvageChance: 0.05,
  drain: 20, // жаднее: под ним живёшь меньше
}

// «Морок» — премиальное поле: легче и экономичнее «Вуали», но втрое дороже. Меньший
// расход растягивает невидимость секунд до двадцати. Лёгкое и мощное — значит дорогое.
const CLOAK_SPECTRE: CloakModule = {
  id: 'cloak_2',
  name: 'Маскировочное поле «Морок»',
  kind: 'cloak',
  class: 3,
  mass: 6, // легче «Вуали» — манёвр щадит
  cost: 390000,
  salvageChance: 0.03,
  drain: 12, // экономичнее всех: дольше под полем
}

/**
 * Миелофон — древний артефакт непрерывного масштаба: даёт борту РАСТИ (до планеты, звезды и
 * дальше). Ставится в аукс-слот, как маскировка, — сила гиганта взамен уловок обычного боя.
 * Класс 1: дар бога встаёт на ЛЮБОЙ корпус, в том числе на стартовый, — иначе подарок
 * требовал бы сперва пересесть. Стата отдельной нет — темп роста и пороги в `config/mielophone`,
 * здесь важно лишь «стоит или нет».
 *
 * Это ДАР СЛОВА, и только он: бог даёт копию тому, кто согласился собирать ему статуи
 * (`dialogue/divineGift.ts`). Не продаётся (`notSold`) и не снимается с обломков — иначе дар
 * был бы лишь бесплатной дорогой к тому, что можно просто купить.
 */
export const MIELOPHONE_DEVICE: MielophoneModule = {
  id: 'mielophone_1',
  name: 'Миелофон',
  kind: 'mielophone',
  class: 1,
  mass: 1,
  cost: 2_000_000,
  salvageChance: 0,
  notSold: true,
}

// ─── Аукс-устройства (ECM / бомба / скуп) ────────────────────────────────────
//
// Каждое — снаряжаемый модуль в универсальный аукс-слот, а не врождённая способность:
// без него не воспользуешься (гейт в `sim/step`). Числа срабатывания живут в
// `config/weapons` (ECM/BOMB); здесь — только «есть устройство или нет», масса и цена.
// Прокачке аукс не подлежит: каждое работает по-своему.

/** Противоракетный импульс: снимает налетающие ракеты, жжёт батареи (см. ECM в weapons). */
export const ECM_UNIT: EcmModule = {
  id: 'ecm_1',
  name: 'Система РЭБ «Заслон»',
  kind: 'ecm',
  class: 2,
  mass: 2,
  cost: 42000,
  salvageChance: 0.35,
}

/** Энергобомба: разовый импульс по площади, полторы минуты на перезаряд (см. BOMB). */
export const BOMB_UNIT: BombModule = {
  id: 'bomb_1',
  name: 'Энергобомба «Удар»',
  kind: 'bomb',
  class: 3,
  mass: 4,
  cost: 160000,
  salvageChance: 0.15,
}

/** Топливный скуп: черпает вещество короны звезды (механика топлива — позже). */
const SCOOP_UNIT: ScoopModule = {
  id: 'scoop_1',
  name: 'Топливозаборник «Черпак»',
  kind: 'scoop',
  class: 1,
  mass: 2,
  cost: 18000,
  salvageChance: 0.5,
}

// Недостающие клетки той же сетки: у линейки есть класс, которого не было, и внутри
// класса масса с ценой расходятся хотя бы на тонну и в полтора раза по кредитам.
// Буква A по-прежнему вершина — её сюда не добавляем туда, где она уже стоит.

const ENGINE_STANDARD_1: EngineModule = {
  id: 'engine_1c',
  name: 'Двигатель 1C «Стандарт»',
  kind: 'engine',
  class: 1,
  mass: 2,
  cost: 14000,
  salvageChance: 0.45,
  thrust: 260,
  maxSpeed: 205,
  optimalMass: 12,
  boostMult: 2.2,
  cruiseMax: 100_000,
  energy: 100,
  energyRegen: 6,
}

const ENGINE_SWIFT_1: EngineModule = {
  id: 'engine_1a',
  name: 'Двигатель 1A «Стриж»',
  kind: 'engine',
  class: 1,
  mass: 1, // тяги меньше, чем у 1C, зато тонна вместо двух
  cost: 36000,
  salvageChance: 0.3,
  thrust: 240,
  maxSpeed: 215,
  optimalMass: 12,
  boostMult: 2.3,
  cruiseMax: 50_000,
  energy: 100,
  energyRegen: 7,
}

const ENGINE_CIVILIAN_2: EngineModule = {
  id: 'engine_2e',
  name: 'Двигатель 2E «Гражданский»',
  kind: 'engine',
  class: 2,
  mass: 4, // вдвое тяжелее «Стандарта» 2C
  cost: 11000, // и заметно дешевле его
  salvageChance: 0.45,
  thrust: 290, // тяга ниже 312 у 2C: дёшево не бывает быстро
  maxSpeed: 200,
  optimalMass: 14,
  boostMult: 2.1,
  cruiseMax: 500_000,
  energy: 100,
  energyRegen: 6,
}

const ENGINE_MILITARY_2: EngineModule = {
  id: 'engine_2d',
  name: 'Двигатель 2D «Военный»',
  kind: 'engine',
  class: 2,
  mass: 3,
  cost: 42000, // дешевле лёгкого «Стрижа», тяжелее «Стандарта»
  salvageChance: 0.25,
  thrust: 410,
  maxSpeed: 235,
  optimalMass: 15,
  boostMult: 2.5,
  cruiseMax: 10_000_000,
  energy: 140,
  energyRegen: 8,
}

const ENGINE_CIVILIAN_3: EngineModule = {
  id: 'engine_3e',
  name: 'Двигатель 3E «Гражданский»',
  kind: 'engine',
  class: 3,
  mass: 6, // самый тяжёлый двигатель каталога
  cost: 28000, // вход в класс 3 за треть цены вершины
  salvageChance: 0.3,
  thrust: 450,
  maxSpeed: 230,
  optimalMass: 16,
  boostMult: 2.3,
  cruiseMax: 20_000_000,
  energy: 130,
  energyRegen: 8,
}

const ENGINE_STANDARD_3: EngineModule = {
  id: 'engine_3d',
  name: 'Двигатель 3D «Стандарт»',
  kind: 'engine',
  class: 3,
  mass: 4,
  cost: 68000,
  salvageChance: 0.2,
  thrust: 510,
  maxSpeed: 255,
  optimalMass: 16,
  boostMult: 2.6,
  cruiseMax: 30_000_000,
  energy: 150,
  energyRegen: 9,
}

const RCS_STANDARD_1: ThrusterModule = {
  id: 'rcs_1c',
  name: 'Маневровые 1C «Стандарт»',
  kind: 'thrusters',
  class: 1,
  mass: 2,
  cost: 12000,
  salvageChance: 0.45,
  lateralThrust: 220,
  torque: [46, 29, 122],
  maxRate: [1.78, 1.04, 2.95],
  angDamp: 1.9,
}

const RCS_VORTEX_1: ThrusterModule = {
  id: 'rcs_1a',
  name: 'Маневровые 1A «Вихрь»',
  kind: 'thrusters',
  class: 1,
  mass: 1,
  cost: 24000, // момент ниже 1C, платят за тонну
  salvageChance: 0.3,
  lateralThrust: 205,
  torque: [44, 28, 118],
  maxRate: [1.9, 1.1, 3.1],
  angDamp: 2.0,
}

const RCS_CIVILIAN_2: ThrusterModule = {
  id: 'rcs_2e',
  name: 'Маневровые 2E «Гражданский»',
  kind: 'thrusters',
  class: 2,
  mass: 3,
  cost: 8000,
  salvageChance: 0.45,
  lateralThrust: 210,
  torque: [44, 28, 116],
  maxRate: [1.72, 1.0, 2.9],
  angDamp: 1.9,
}

const RCS_MILITARY_2: ThrusterModule = {
  id: 'rcs_2d',
  name: 'Маневровые 2D «Военные»',
  kind: 'thrusters',
  class: 2,
  mass: 2,
  cost: 36000,
  salvageChance: 0.25,
  lateralThrust: 300,
  torque: [62, 39, 160],
  maxRate: [2.15, 1.24, 3.4], // ниже потолка 3A: перекрутить игрока нельзя
  angDamp: 2.1,
}

const RCS_CIVILIAN_3: ThrusterModule = {
  id: 'rcs_3e',
  name: 'Маневровые 3E «Гражданский»',
  kind: 'thrusters',
  class: 3,
  mass: 4,
  cost: 22000,
  salvageChance: 0.3,
  lateralThrust: 280,
  torque: [58, 36, 150],
  maxRate: [2.0, 1.15, 3.2],
  angDamp: 2.0,
}

const RCS_STANDARD_3: ThrusterModule = {
  id: 'rcs_3d',
  name: 'Маневровые 3D «Стандарт»',
  kind: 'thrusters',
  class: 3,
  mass: 2,
  cost: 70000,
  salvageChance: 0.2,
  lateralThrust: 300,
  torque: [66, 41, 168],
  maxRate: [2.25, 1.28, 3.55],
  angDamp: 2.2,
}

const SHIELD_STANDARD_1: ShieldModule = {
  id: 'shield_1c',
  name: 'Щит 1C',
  kind: 'shield',
  class: 1,
  mass: 2,
  cost: 16000,
  salvageChance: 0.45,
  capacity: 240,
  regen: 3.2,
  regenDelay: 4.6,
}

const SHIELD_MIRAGE_1: ShieldModule = {
  id: 'shield_1a',
  name: 'Щит 1A «Мираж»',
  kind: 'shield',
  class: 1,
  mass: 1, // ёмкости меньше, чем у 1C, регенерация выше
  cost: 28000,
  salvageChance: 0.3,
  capacity: 175,
  regen: 4.8,
  regenDelay: 3.2,
}

export const SHIELD_CIVILIAN_2: ShieldModule = {
  id: 'shield_2e',
  name: 'Щит 2E',
  kind: 'shield',
  class: 2,
  mass: 3,
  cost: 9000,
  salvageChance: 0.45,
  capacity: 280, // меньше стокового 2C (325)
  regen: 3.5,
  regenDelay: 5.2,
}

const SHIELD_CIVILIAN_3: ShieldModule = {
  id: 'shield_3e',
  name: 'Щит 3E',
  kind: 'shield',
  class: 3,
  mass: 5,
  cost: 24000,
  salvageChance: 0.3,
  capacity: 480, // меньше входного «Бастиона» 3C
  regen: 6,
  regenDelay: 5.5,
}

const SHIELD_STANDARD_3: ShieldModule = {
  id: 'shield_3d',
  name: 'Щит 3D',
  kind: 'shield',
  class: 3,
  mass: 3,
  cost: 72000,
  salvageChance: 0.2,
  capacity: 640,
  regen: 7.5, // ёмкости больше 3C, регенерация меньше: не замена, а другой размен
  regenDelay: 4.4,
}

const ARMOUR_STEEL_1: ArmourModule = {
  id: 'armour_1d',
  name: 'Броня 1D «Сталь»',
  kind: 'armour',
  class: 1,
  mass: 3,
  cost: 6000,
  salvageChance: 0.5,
  hull: 160, // больше плит и «Керамета» 1C, и тяжелее обоих
}

const ARMOUR_COMPOSITE_1: ArmourModule = {
  id: 'armour_1b',
  name: 'Броня 1B «Композит»',
  kind: 'armour',
  class: 1,
  mass: 2,
  cost: 14000,
  salvageChance: 0.45,
  hull: 120,
}

const ARMOUR_STEEL_2E: ArmourModule = {
  id: 'armour_2e',
  name: 'Броня 2E «Сталь»',
  kind: 'armour',
  class: 2,
  mass: 5,
  cost: 14000,
  salvageChance: 0.45,
  hull: 300, // меньше 2D, ещё тяжелее и дешевле
}

const ARMOUR_STEEL_3D: ArmourModule = {
  id: 'armour_3d',
  name: 'Броня 3D «Сталь»',
  kind: 'armour',
  class: 3,
  mass: 6,
  cost: 40000,
  salvageChance: 0.25,
  hull: 640,
}

const ARMOUR_COMPOSITE_3: ArmourModule = {
  id: 'armour_3b',
  name: 'Броня 3B «Композит»',
  kind: 'armour',
  class: 3,
  mass: 4, // легче стали 3C, тяжелее «Керамета» 3A
  cost: 90000,
  salvageChance: 0.2,
  hull: 640,
}

const ARMOUR_CERAMET_3B: ArmourModule = {
  id: 'armour_3k',
  name: 'Броня 3B «Керамет»',
  kind: 'armour',
  class: 3,
  mass: 2,
  cost: 110000, // меньше корпуса, чем у 3A, и легче — платят ценой
  salvageChance: 0.15,
  hull: 540,
}

const PULSE_LASER_2B: LaserModule = {
  id: 'pulse_2b',
  name: 'Импульсный лазер 2B',
  kind: 'laser',
  class: 2,
  mass: 1,
  cost: 28000,
  salvageChance: 0.3,
  damage: 15,
  range: 4000,
  cooldown: 0.2, // ~75/с — всё ещё слабее любого луча того же класса
  heatPerShot: 0.11,
  heatCool: 0.28,
}

const PULSE_LASER_3C: LaserModule = {
  id: 'pulse_3c',
  name: 'Импульсный лазер 3C',
  kind: 'laser',
  class: 3,
  mass: 2,
  cost: 48000,
  salvageChance: 0.25,
  damage: 20,
  range: 4000,
  cooldown: 0.22,
  heatPerShot: 0.12,
  heatCool: 0.26,
}

const PULSE_LASER_3: LaserModule = {
  id: 'pulse_3',
  name: 'Импульсный лазер 3B',
  kind: 'laser',
  class: 3,
  mass: 1,
  cost: 90000,
  salvageChance: 0.18,
  damage: 22,
  range: 4000,
  cooldown: 0.18, // ~122/с, ниже входного луча 3C
  heatPerShot: 0.12,
  heatCool: 0.28,
}

const BEAM_LASER_2C: LaserModule = {
  id: 'beam_2c',
  name: 'Лучевой лазер 2C',
  kind: 'laser',
  class: 2,
  mass: 2,
  cost: 28000, // дешевле «Лучевого 2», горячее и слабее
  salvageChance: 0.3,
  beam: true,
  damage: 110,
  range: 4000,
  cooldown: 0,
  heatPerShot: 0.26,
  heatCool: 0.2,
}

const BEAM_LASER_3C: LaserModule = {
  id: 'beam_3c',
  name: 'Лучевой лазер 3C',
  kind: 'laser',
  class: 3,
  mass: 2,
  cost: 80000,
  salvageChance: 0.18,
  beam: true,
  damage: 170, // выше любого импульсного 3-го класса, ниже «Клинка»
  range: 4000,
  cooldown: 0,
  heatPerShot: 0.28,
  heatCool: 0.2,
}

const ROTARY_LASER_3: LaserModule = {
  id: 'rotary_3',
  name: 'Роторный лазер 3 «Шквал»',
  kind: 'laser',
  class: 3,
  mass: 2,
  cost: 70000,
  salvageChance: 0.2,
  damage: 7, // мелко: плазма того же каталога бьёт больше чем впятеро за выстрел
  range: 4000,
  cooldown: 0.05,
  heatPerShot: 0.13,
  heatCool: 0.34,
}

const PLASMA_GUN_1: LaserModule = {
  id: 'plasma_1',
  name: 'Плазменное орудие 1 «Игла»',
  kind: 'laser',
  class: 1,
  mass: 2,
  cost: 18000,
  salvageChance: 0.35,
  damage: 40,
  range: 4000,
  cooldown: 1.1,
  heatPerShot: 0.28,
  heatCool: 0.18,
}

const MISSILE_HAMMER_E: MissileModule = {
  id: 'missile_2e',
  name: 'Ракета 2E «Молот»',
  kind: 'missile',
  class: 2,
  mass: 3,
  cost: 22000,
  salvageChance: 0.25,
  ammo: 3,
  damage: 300,
  speed: 400,
  armTime: 0.26,
  boostTime: 0.72,
  turnRate: 0.8,
  seekerRate: 1.35,
  lifetime: 13,
}

const MISSILE_HORNET_3: MissileModule = {
  id: 'missile_3p',
  name: 'Ракета 3C «Оса»',
  kind: 'missile',
  class: 3,
  mass: 3,
  cost: 48000,
  salvageChance: 0.2,
  ammo: 2,
  damage: 640,
  speed: 540,
  armTime: 0.2,
  boostTime: 0.6,
  turnRate: 1.15,
  seekerRate: 2.2,
  lifetime: 12,
}

const MISSILE_SEEKER_3: MissileModule = {
  id: 'missile_3b',
  name: 'Ракета 3B «Гончая»',
  kind: 'missile',
  class: 3,
  mass: 2,
  cost: 90000,
  salvageChance: 0.16,
  ammo: 5,
  damage: 280,
  speed: 520,
  armTime: 0.16,
  boostTime: 0.55,
  turnRate: 1.2,
  seekerRate: 3.4,
  lifetime: 13,
}

const MISSILE_HAMMER_3: MissileModule = {
  id: 'missile_3e',
  name: 'Ракета 3E «Кувалда»',
  kind: 'missile',
  class: 3,
  mass: 4,
  cost: 70000,
  salvageChance: 0.14,
  ammo: 2,
  damage: 700,
  speed: 380,
  armTime: 0.32,
  boostTime: 0.85,
  turnRate: 0.7,
  seekerRate: 1.2,
  lifetime: 16,
}

const HYPERDRIVE_HAULER_1: HyperdriveModule = {
  id: 'hyper_1h',
  name: 'Гиперпривод 1E «Тягач»',
  kind: 'hyperdrive',
  class: 1,
  mass: 4,
  cost: 6000,
  salvageChance: 0.3,
  jumpRange: 22, // короче соседского шага: дёшево, но не из каждой системы
}

const HYPERDRIVE_BASIC_C: HyperdriveModule = {
  id: 'hyper_1c',
  name: 'Гиперпривод 1C «Аркан»',
  kind: 'hyperdrive',
  class: 1,
  mass: 2,
  cost: 60000,
  salvageChance: 0.18,
  jumpRange: 32,
}

const HYPERDRIVE_LONG_E: HyperdriveModule = {
  id: 'hyper_2e',
  name: 'Гиперпривод 2E «Меридиан»',
  kind: 'hyperdrive',
  class: 2,
  mass: 5,
  cost: 48000,
  salvageChance: 0.16,
  jumpRange: 36, // между соседским 1E и рабочим 2C, зато очень тяжёлый
}

const HYPERDRIVE_LONG_C: HyperdriveModule = {
  id: 'hyper_3c',
  name: 'Гиперпривод 3C «Меридиан»',
  kind: 'hyperdrive',
  class: 3,
  mass: 4,
  cost: 180000,
  salvageChance: 0.1,
  jumpRange: 70,
}

const HYPERDRIVE_SWIFT_3: HyperdriveModule = {
  id: 'hyper_3b',
  name: 'Гиперпривод 3B «Стриж»',
  kind: 'hyperdrive',
  class: 3,
  mass: 2, // легче «Дальнего», дальность заметно меньше — платят за тонны
  cost: 680000,
  salvageChance: 0.06,
  jumpRange: 62,
}

export const MODULE_CATALOGUE: readonly ShipModule[] = [
  ENGINE_CIVILIAN, ENGINE_CIVILIAN_D, ENGINE_STANDARD_1, ENGINE_SWIFT_1,
  ENGINE_CIVILIAN_2, ENGINE_STANDARD, ENGINE_STANDARD_B, ENGINE_MILITARY_2,
  ENGINE_SWIFT, ENGINE_SWIFT_B,
  ENGINE_CIVILIAN_3, ENGINE_MILITARY_C, ENGINE_STANDARD_3, ENGINE_MILITARY,
  RCS_CIVILIAN, RCS_CIVILIAN_D, RCS_STANDARD_1, RCS_VORTEX_1,
  RCS_CIVILIAN_2, RCS_STANDARD, RCS_STANDARD_B, RCS_MILITARY_2,
  RCS_VORTEX, RCS_VORTEX_B,
  RCS_CIVILIAN_3, RCS_MILITARY_C, RCS_STANDARD_3, RCS_MILITARY,
  SHIELD_LIGHT, SHIELD_LIGHT_D, SHIELD_STANDARD_1, SHIELD_MIRAGE_1,
  SHIELD_CIVILIAN_2, SHIELD_STANDARD, SHIELD_STANDARD_B,
  SHIELD_MIRAGE, SHIELD_MIRAGE_B,
  SHIELD_CIVILIAN_3, SHIELD_HEAVY_C, SHIELD_STANDARD_3, SHIELD_HEAVY,
  ARMOUR_PLATE, ARMOUR_STEEL_1, ARMOUR_COMPOSITE_1, ARMOUR_CERAMET_1,
  ARMOUR_STEEL_2E, ARMOUR_STEEL_2, ARMOUR_COMPOSITE, ARMOUR_COMPOSITE_B, ARMOUR_CERAMET_2,
  ARMOUR_STEEL_3D, ARMOUR_STEEL_3, ARMOUR_COMPOSITE_3, ARMOUR_CERAMET_3B, ARMOUR_CERAMET_3,
  PULSE_LASER_WORN, PULSE_LASER, PULSE_LASER_FINE, PULSE_LASER_CENTRAL, BURST_LASER, PULSE_LASER_2B,
  PULSE_LASER_3C, PULSE_LASER_3,
  BEAM_LASER_LIGHT, BEAM_LASER_2C, BEAM_LASER, BEAM_LASER_3C, BEAM_LASER_HEAVY,
  ROTARY_LASER, ROTARY_LASER_B, ROTARY_LASER_3,
  PLASMA_GUN_1, PLASMA_GUN, PLASMA_GUN_HEAVY,
  MINING_LASER, SHRINK_RAY, GROW_RAY, HOLD_RAY, SEED_RAY, SHATTER_CANNON,
  MISSILE_STING, MISSILE_PYLON, MISSILE_WASP,
  MISSILE_SWARM, MISSILE_HOMING, MISSILE_HOUND,
  MISSILE_HAMMER_E, MISSILE_HEAVY, MISSILE_SLEDGE,
  MISSILE_HORNET_3, MISSILE_SEEKER_3, MISSILE_HAMMER_3,
  CARGO_SMALL, CARGO_MEDIUM, CARGO_LARGE, CARGO_HUGE, CARGO_GIANT,
  HYPERDRIVE_HAULER_1, HYPERDRIVE_BASIC, HYPERDRIVE_BASIC_C,
  HYPERDRIVE_LONG_E, HYPERDRIVE_LONG, HYPERDRIVE_LONG_C, HYPERDRIVE_DEEP,
  HYPERDRIVE_COMPACT, HYPERDRIVE_COMPACT_B, HYPERDRIVE_SWIFT_3,
  HYPERDRIVE_HAULER, HYPERDRIVE_HAULER_B,
  CLOAK_FIELD, CLOAK_HAZE, CLOAK_SPECTRE,
  DRONE_BAY, DRONE_BAY_LIGHT, DRONE_BAY_HEAVY,
  MIELOPHONE_DEVICE,
  ECM_UNIT, BOMB_UNIT, SCOOP_UNIT,
]

// Цена в литералах выше не действует: её считает формула характеристики на тонну.
for (const module of MODULE_CATALOGUE) {
  if (module.kind === 'mielophone') continue
  module.cost = listPrice(module)
}

/**
 * Снятые из каталога модули → их замена. Сейв хранит id: без этой карты старый «Композит»
 * в трюме или в слоте просто исчез бы при загрузке. Ведём по ближайшей вместимости.
 */
const RETIRED_MODULES: Readonly<Record<string, string>> = {
  cargo_1a: 'cargo_1',
  cargo_2a: 'cargo_2',
  cargo_3a: 'cargo_4',
  cargo_2h: 'cargo_3',
  cargo_3h: 'cargo_5',
}

export function findModule(id: string): ShipModule | null {
  const live = RETIRED_MODULES[id] ?? id
  return MODULE_CATALOGUE.find((m) => m.id === live) ?? null
}
