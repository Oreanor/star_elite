import { rigOf } from './rig'
import type { Chassis } from './schema'

/**
 * Каталог корпусов. Новый корабль = запись здесь + GLB-модель в реестре рендера (или фабрика
 * геометрии). Симуляцию трогать не нужно. Все лётные корпуса — загруженные меши; процедурные
 * (Мк III, Арес, Аполлон и пр.) сняты из игры. «Каллиопа» (DRONE) — не лётный, а капсула/дрон.
 */

/**
 * «Ника» (id `aurora_one` — прежнее имя «Аврора One», id не меняем ради сейвов и модели) —
 * СТАРТОВЫЙ корпус, из дешёвых: длинный острый нос, дельта-
 * крыло с поднятыми законцовками, спаренные гондолы и два наклонных киля. Геометрия —
 * НЕ процедурная, а загруженный меш (`aurora_one.glb`), поэтому корпус живёт как обычная
 * запись каталога, а рендер сам знает по id, что грузить сетку, а не собирать из примитивов.
 */
/**
 * Слоты прежней «Авроры» класса 3 — их и наследует корабль бога («Святой Дух»): ему нужен
 * аукс третьего класса под миелофон. Сама «Ника» теперь стартовая, класса 2 (см. ниже).
 */
const SANCTUS_SLOTS: Chassis['slots'] = [
  { kind: 'engine', maxClass: 3 },
  { kind: 'thrusters', maxClass: 3 },
  { kind: 'shield', maxClass: 3 },
  { kind: 'armour', maxClass: 2 },
  { kind: 'armour', maxClass: 2 },
  { kind: 'cargo', maxClass: 3 },
  { kind: 'cargo', maxClass: 3 },
  { kind: 'cargo', maxClass: 3 },
  { kind: 'hyperdrive', maxClass: 3 },
  { kind: 'aux', maxClass: 3 },
]

export const AURORA_ONE: Chassis = {
  id: 'aurora_one',
  name: 'Ника',
  // СТАРТОВАЯ рама — вторая ступень снизу: класс 2, одна броня, одна пара пилонов. Прежде
  // это была «Аврора» класса 3 с двумя бронями и четырьмя пилонами — сильнее всех дешёвых
  // и середины лестницы, и расти было некуда.
  class: 2,
  baseMass: 8,
  baseHull: 140,
  cargoCapacity: 18,
  auxCapacity: 100,
  radius: 12,
  inertiaFactor: 1.0,
  assistLateralDamp: 1.25,
  assistSpeedDamp: 0.35,
  hardpoints: [
    // Три орудийные точки в разных МЕСТАХ рамы: середина крыла, законцовки, нос. Крыльевые —
    // пары (мощность делится между дулами, в сумме паспортная), носовая — одиночная и вдвое
    // крупнее калибром: какой ствол туда ни поставь, он бьёт вдвое толще и больнее.
    // Координаты дул — в метрах модельного пространства (нос −Z, размах ±X), сняты редактором
    // дул (K) по силуэту меша и согласованы с его масштабом в ships.ts.
    { offset: [0, -0.86, 0.53], kind: 'gun', maxClass: 2, nozzles: [[-3.82, -0.86, 0.53], [3.82, -0.86, 0.53]] },
    { offset: [0, -1.21, -0.02], kind: 'gun', maxClass: 2, nozzles: [[-7.09, -1.21, -0.02], [7.09, -1.21, -0.02]] },
    { offset: [0, -0.87, -8.52], kind: 'gun', maxClass: 2, bore: 2, nozzles: [[0, -0.87, -8.52]] },
    // Одна пара пилонов — стартовой раме хватит.
    { offset: [-5.0, -0.8, 3.0], kind: 'pylon', maxClass: 1 },
    { offset: [5.0, -0.8, 3.0], kind: 'pylon', maxClass: 1 },
  ],
  slots: [
    { kind: 'engine', maxClass: 2 },
    { kind: 'thrusters', maxClass: 2 },
    { kind: 'shield', maxClass: 2 },
    { kind: 'armour', maxClass: 2 },
    // Три грузовых слота у КАЖДОГО корпуса: контейнеры бесклассовые и переезжают при смене
    // рамы все, а не «сколько влезло» — торговцу пересесть на другой корпус не наказание.
    { kind: 'cargo', maxClass: 2 },
    { kind: 'cargo', maxClass: 2 },
    { kind: 'cargo', maxClass: 2 },
    { kind: 'hyperdrive', maxClass: 2 },
    { kind: 'aux', maxClass: 2 },
  ],
  cost: 40_000,
}

/**
 * «Spiritus Sanctus» — личный корабль игрока. Рама и раскладка полностью наследуют
 * «Аврору One»; собственный id нужен, чтобы модель и владение честно жили в сейве.
 * Единственное визуальное отличие силовой установки — одно центральное сопло — задаёт рендер.
 */
export const SPIRITUS_SANCTUS: Chassis = {
  ...AURORA_ONE,
  id: 'spiritus_sanctus',
  name: 'Spiritus Sanctus',
  // Класс и слоты — прежней «Авроры»: миелофону нужен аукс третьего класса.
  class: 3,
  slots: SANCTUS_SLOTS,
  // Своя раскладка дул (K): силуэт тот же, но сопло одно центральное, и точки садятся
  // иначе. Пилонов нет вовсе — потому и не наследуем их у «Авроры».
  hardpoints: [
    { offset: [0, 1.39, -6.3], kind: 'gun', maxClass: 2, nozzles: [[-7.5, 1.39, -6.3], [7.5, 1.39, -6.3]] },
    { offset: [0, 0.24, -4.39], kind: 'gun', maxClass: 3, nozzles: [[-3.03, 0.24, -4.39], [3.03, 0.24, -4.39]] },
    { offset: [0, 0.59, -7.79], kind: 'gun', maxClass: 3, bore: 2, nozzles: [[0, 0.59, -7.79]] },
  ],
}

/**
 * Истребители из внешних мешей (Meshy GLB). Геометрия — не процедура, а загруженная сетка
 * со своими текстурами (рендер знает по id из реестра GLB_HULLS).
 *
 * Раскладка дул у КАЖДОГО своя: силуэты разные, и общий набор сажал стволы мимо крыла.
 * Три орудийные точки на всех — середина крыла, законцовки, нос (носовая вдвое крупнее
 * калибром) — плюс два пилона. Координаты сняты редактором дул (K) по каждому мешу.
 */
const FIGHTER_PYLONS: Chassis['hardpoints'] = [
  { offset: [-3.2, -0.5, 2.5], kind: 'pylon', maxClass: 1 },
  { offset: [3.2, -0.5, 2.5], kind: 'pylon', maxClass: 1 },
]

/**
 * «Гермес»: узкий корпус — крыльевые пары сидят тесно, нос приподнят над обводом. Тяжёлый
 * военный корабль ВТРОЕ крупнее истребителей (`HERMES_SIZE`): точки сняты редактором дул на
 * меше истребительного размера и масштабированы тем же множителем, что и сам меш в рендере.
 */
export const HERMES_SIZE = 3
const scaleHardpoints = (hps: Chassis['hardpoints'], k: number): Chassis['hardpoints'] =>
  hps.map((hp) => ({
    ...hp,
    offset: [hp.offset[0] * k, hp.offset[1] * k, hp.offset[2] * k] as const,
    ...(hp.nozzles ? { nozzles: hp.nozzles.map((n) => [n[0] * k, n[1] * k, n[2] * k] as const) } : {}),
  }))
const HERMES_HARDPOINTS: Chassis['hardpoints'] = scaleHardpoints(
  [
    { offset: [0, -0.78, -6.95], kind: 'gun', maxClass: 3, nozzles: [[-0.74, -0.78, -6.95], [0.74, -0.78, -6.95]] },
    { offset: [0, -0.95, 0.01], kind: 'gun', maxClass: 3, nozzles: [[-2.44, -0.95, 0.01], [2.44, -0.95, 0.01]] },
    { offset: [0, 1.22, -0.47], kind: 'gun', maxClass: 3, bore: 2, nozzles: [[0, 1.22, -0.47]] },
    ...FIGHTER_PYLONS,
  ],
  HERMES_SIZE,
)

/** «Персей»: законцовки отнесены назад по стреловидности, нос длинный. */
const PERSEUS_HARDPOINTS: Chassis['hardpoints'] = [
  { offset: [0, -0.47, 1.85], kind: 'gun', maxClass: 2, nozzles: [[-3, -0.47, 1.85], [3, -0.47, 1.85]] },
  { offset: [0, -0.18, 4.41], kind: 'gun', maxClass: 3, nozzles: [[-4.8, -0.18, 4.41], [4.8, -0.18, 4.41]] },
  { offset: [0, -0.92, -7.61], kind: 'gun', maxClass: 3, bore: 2, nozzles: [[0, -0.92, -7.61]] },
  ...FIGHTER_PYLONS,
]

/** «Пегас»: размах шире прочих — законцовки почти в семи метрах от оси. */
const PEGASUS_HARDPOINTS: Chassis['hardpoints'] = [
  { offset: [0, -1.11, -2.53], kind: 'gun', maxClass: 2, nozzles: [[-3.55, -1.11, -2.53], [3.55, -1.11, -2.53]] },
  { offset: [0, 0.27, 3.22], kind: 'gun', maxClass: 3, nozzles: [[-6.86, 0.27, 3.22], [6.86, 0.27, 3.22]] },
  { offset: [0, -1.04, -8.38], kind: 'gun', maxClass: 3, bore: 2, nozzles: [[0, -1.04, -8.38]] },
  ...FIGHTER_PYLONS,
]

/** «Орион»: тяжёлый истребитель, законцовки разнесены и приспущены. */
const ORION_HARDPOINTS: Chassis['hardpoints'] = [
  { offset: [0, -0.98, 0.93], kind: 'gun', maxClass: 2, nozzles: [[-3.46, -0.98, 0.93], [3.46, -0.98, 0.93]] },
  { offset: [0, -1.62, -0.67], kind: 'gun', maxClass: 3, nozzles: [[-7.57, -1.62, -0.67], [7.57, -1.62, -0.67]] },
  { offset: [0, -0.84, -8.15], kind: 'gun', maxClass: 3, bore: 2, nozzles: [[0, -0.84, -8.15]] },
  ...FIGHTER_PYLONS,
]

/** «Тесей»: законцовки далеко от оси, нос короткий. */
const THESEUS_HARDPOINTS: Chassis['hardpoints'] = [
  { offset: [0, -1.12, -2.21], kind: 'gun', maxClass: 2, nozzles: [[-3.59, -1.12, -2.21], [3.59, -1.12, -2.21]] },
  { offset: [0, -0.65, -1.19], kind: 'gun', maxClass: 3, nozzles: [[-7.18, -0.65, -1.19], [7.18, -0.65, -1.19]] },
  { offset: [0, -0.26, -6.9], kind: 'gun', maxClass: 3, bore: 2, nozzles: [[0, -0.26, -6.9]] },
  ...FIGHTER_PYLONS,
]
const FIGHTER_SLOTS: Chassis['slots'] = [
  { kind: 'engine', maxClass: 3 },
  { kind: 'thrusters', maxClass: 3 },
  { kind: 'shield', maxClass: 2 },
  { kind: 'armour', maxClass: 2 },
  // Три грузовых, как у всех (см. «Аврору»).
  { kind: 'cargo', maxClass: 1 },
  { kind: 'cargo', maxClass: 1 },
  { kind: 'cargo', maxClass: 1 },
  { kind: 'hyperdrive', maxClass: 2 },
  { kind: 'aux', maxClass: 2 },
]

/**
 * Цены — лестница примерно вдвое на ступень, не плюс-минус десять процентов: иначе следующий
 * корпус почти не дороже и менять его незачем. Класс рамы растёт вместе с ценой (пол — 2:
 * на «Икаре» летают пираты, а их РЭБ второго класса). С «Пегаса» рама уже третьего — на неё
 * встаёт военное железо, которого дешёвые не примут. «Ника» — стартовый корабль, вторая ступень.
 * Прочность, трюм и аукс растут вместе с ценой.
 *
 * «Гермес» — тяжёлый ВОЕННЫЙ корабль, а не скороход: класс 3, толстая рама, два слота брони
 * и щит третьего класса. Платит за это массой и ленью в развороте. Вершина лестницы — корабль
 * флота, а не первая покупка.
 */
const HERMES_SLOTS: Chassis['slots'] = [
  { kind: 'engine', maxClass: 3 },
  { kind: 'thrusters', maxClass: 3 },
  { kind: 'shield', maxClass: 3 },
  { kind: 'armour', maxClass: 3 },
  { kind: 'armour', maxClass: 3 },
  { kind: 'cargo', maxClass: 1 },
  { kind: 'cargo', maxClass: 1 },
  { kind: 'cargo', maxClass: 1 },
  { kind: 'hyperdrive', maxClass: 3 },
  { kind: 'aux', maxClass: 3 },
]

export const HERMES: Chassis = {
  id: 'hermes', name: 'Гермес', class: 3, baseMass: 24, baseHull: 900, cargoCapacity: 32, auxCapacity: 200,
  radius: 8 * HERMES_SIZE, inertiaFactor: 1.15, aerobatics: false, assistLateralDamp: 1.0, assistSpeedDamp: 0.35,
  hardpoints: HERMES_HARDPOINTS, slots: HERMES_SLOTS, cost: 2_400_000,
}

/** «Персей» — сбалансированный перехватчик. */
export const PERSEUS: Chassis = {
  id: 'perseus', name: 'Персей', class: 3, baseMass: 9, baseHull: 380, cargoCapacity: 18, auxCapacity: 140,
  radius: 9, inertiaFactor: 0.88, assistLateralDamp: 1.2, assistSpeedDamp: 0.35,
  hardpoints: PERSEUS_HARDPOINTS, slots: FIGHTER_SLOTS, cost: 300_000,
}

/** «Пегас» — вёрткий, с чуть большим трюмом. */
export const PEGASUS: Chassis = {
  id: 'pegasus', name: 'Пегас', class: 3, baseMass: 8, baseHull: 280, cargoCapacity: 26, auxCapacity: 120,
  radius: 9, inertiaFactor: 0.82, assistLateralDamp: 1.25, assistSpeedDamp: 0.35,
  hardpoints: PEGASUS_HARDPOINTS, slots: FIGHTER_SLOTS, cost: 150_000,
}

/** «Орион» — тяжёлый истребитель: крепче, но вальяжнее. */
export const ORION: Chassis = {
  id: 'orion', name: 'Орион', class: 3, baseMass: 14, baseHull: 680, cargoCapacity: 24, auxCapacity: 160,
  radius: 10, inertiaFactor: 0.98, assistLateralDamp: 1.1, assistSpeedDamp: 0.35,
  hardpoints: ORION_HARDPOINTS, slots: FIGHTER_SLOTS, cost: 1_200_000,
}

/** «Тесей» — ещё один лёгкий истребитель (GLB-меш). */
/**
 * «Афина» и «Икар» — свежие серийные истребители. Раскладка точек ЗАВОДСКАЯ, снятая с
 * «Тесея»: силуэты близкие, а точные места дул и пилонов подбираются глазами в редакторе
 * оснастки (K) — там их и поправят, не трогая ни бой, ни верфь.
 */
export const ATHENA: Chassis = {
  id: 'athena', name: 'Афина', class: 3, baseMass: 11, baseHull: 500, cargoCapacity: 20, auxCapacity: 150,
  radius: 8, inertiaFactor: 0.85, assistLateralDamp: 1.25, assistSpeedDamp: 0.35,
  hardpoints: THESEUS_HARDPOINTS, slots: FIGHTER_SLOTS, cost: 600_000,
}

/** «Икар» — легче и вёртче «Афины», но и шкура тоньше: скорость вместо брони. */
export const ICARUS: Chassis = {
  id: 'icarus', name: 'Икар', class: 2, baseMass: 4.5, baseHull: 80, cargoCapacity: 8, auxCapacity: 80,
  radius: 7, inertiaFactor: 0.72, assistLateralDamp: 1.45, assistSpeedDamp: 0.35,
  hardpoints: THESEUS_HARDPOINTS, slots: FIGHTER_SLOTS, cost: 22_000,
}

export const THESEUS: Chassis = {
  id: 'theseus', name: 'Тесей', class: 2, baseMass: 6, baseHull: 200, cargoCapacity: 12, auxCapacity: 100,
  radius: 8, inertiaFactor: 0.8, assistLateralDamp: 1.3, assistSpeedDamp: 0.35,
  hardpoints: THESEUS_HARDPOINTS, slots: FIGHTER_SLOTS, cost: 75_000,
}

/**
 * «Атлас» — корабль поколений: тяжёлый ковчег, не истребитель. Своя раскладка: медлительный,
 * толстошкурый, с огромным трюмом. Дула по бортам — оборона, а не охота. Габарит крупнее
 * прочих (в рендере scale выше), потому смещения дул разнесены шире.
 */
const ATLAS_HARDPOINTS: Chassis['hardpoints'] = [
  { offset: [0, -5.57, -17.14], kind: 'gun', maxClass: 3, nozzles: [[-23.47, -5.57, -17.14], [23.47, -5.57, -17.14]] },
  { offset: [0, 2.31, -17.64], kind: 'gun', maxClass: 3, nozzles: [[-9, 2.31, -17.64], [9, 2.31, -17.64]] },
  { offset: [0, 2.19, -59.06], kind: 'gun', maxClass: 3, bore: 2, nozzles: [[0, 2.19, -59.06]] },
  { offset: [-5.0, -1.0, 5.0], kind: 'pylon', maxClass: 2 },
  { offset: [5.0, -1.0, 5.0], kind: 'pylon', maxClass: 2 },
]
export const ATLAS: Chassis = {
  id: 'atlas', name: 'Атлас', class: 3, baseMass: 42, baseHull: 620, cargoCapacity: 220, auxCapacity: 160,
  // Габарит ковчега, м. Ходит В ПАРЕ с масштабом его меша (`GLB_HULLS` в `ships.ts`, сейчас 120):
  // этим радиусом ловят попадания, и разъедься они — лучи пойдут сквозь видимый борт, не задев.
  radius: 100, inertiaFactor: 2.4, assistLateralDamp: 0.7, assistSpeedDamp: 0.35,
  hardpoints: ATLAS_HARDPOINTS,
  slots: [
    { kind: 'engine', maxClass: 3 },
    { kind: 'thrusters', maxClass: 2 }, // ковчег: маневровые слабее ходовых — тяжело крутится
    { kind: 'shield', maxClass: 3 },
    { kind: 'armour', maxClass: 3 },
    { kind: 'armour', maxClass: 2 },
    { kind: 'cargo', maxClass: 3 },
    { kind: 'cargo', maxClass: 3 },
    { kind: 'cargo', maxClass: 3 },
    { kind: 'hyperdrive', maxClass: 3 },
    { kind: 'aux', maxClass: 3 },
  ],
  cost: 480_000,
}

/**
 * Оснастка из редактора (`rig.json`) перекрывает заводскую раскладку дул и подвесов. Делается
 * ОДИН раз при загрузке конфига, до того как каталог кто-то прочтёт: дальше это обычные данные.
 */
for (const chassis of [SPIRITUS_SANCTUS, AURORA_ONE, HERMES, PERSEUS, PEGASUS, ORION, THESEUS, ATHENA, ICARUS, ATLAS]) {
  const rig = rigOf(chassis.id)
  if (rig?.hardpoints) chassis.hardpoints = rig.hardpoints
}

export const CHASSIS_CATALOGUE: readonly Chassis[] = [
  SPIRITUS_SANCTUS,
  AURORA_ONE,
  HERMES,
  PERSEUS,
  PEGASUS,
  ORION,
  THESEUS,
  ATHENA,
  ICARUS,
  ATLAS,
]

export function findChassis(id: string): Chassis | null {
  return CHASSIS_CATALOGUE.find((c) => c.id === id) ?? null
}

/**
 * Беспилотник. Не корабль для полёта, а расходник: живёт минуту и сгорает.
 *
 * Лёгкий и вёрткий (inertiaFactor 0.4), но с картонным корпусом и без щита —
 * слот под него просто не предусмотрен. Отсюда его роль: он не выигрывает бой,
 * он оттягивает на себя чужой прицел, и пират тратит на него очередь, которая
 * иначе досталась бы игроку.
 *
 * Один ствол по оси, без пилонов. Ракету беспилотник не понесёт: пусковая
 * тяжелее его самого.
 */
export const DRONE: Chassis = {
  id: 'drone',
  name: 'Каллиопа',
  class: 1,
  baseMass: 0.9,
  baseHull: 55,
  // Спасательная капсула: 10 т грузоподъёмности — ровно чтобы вынести из осколков
  // миелофон или важный груз (см. эскейп-под). Аукс-энергия — его живучесть в роли пода.
  cargoCapacity: 10,
  auxCapacity: 100,
  /** м. Втрое мельче «Ареса»: попасть в него — отдельная задача. */
  radius: 3,
  inertiaFactor: 0.4,
  assistLateralDamp: 1.4,
  assistSpeedDamp: 0.4,
  hardpoints: [{ offset: [0, 0, -0.8], kind: 'gun', maxClass: 1 }],
  slots: [
    { kind: 'engine', maxClass: 1 },
    { kind: 'thrusters', maxClass: 1 },
    // Боевому дрону пуст (его сборка без привода), но купленная «Каллиопа» — крошечный
    // скорострельный скаут, и улететь на нём из системы должно быть можно.
    { kind: 'hyperdrive', maxClass: 1 },
    { kind: 'aux', maxClass: 1 },
    // Три грузовых, как у всех (см. «Аврору»).
    { kind: 'cargo', maxClass: 1 },
    { kind: 'cargo', maxClass: 1 },
    { kind: 'cargo', maxClass: 1 },
  ],
  cost: 9_000,
}
