import type { Chassis } from '../domain/loadout'

/**
 * Каталог корпусов. Новый корабль = запись здесь + GLB-модель в реестре рендера (или фабрика
 * геометрии). Симуляцию трогать не нужно. Все лётные корпуса — загруженные меши; процедурные
 * (Мк III, Арес, Аполлон и пр.) сняты из игры. «Каллиопа» (DRONE) — не лётный, а капсула/дрон.
 */

/**
 * «Аврора One» — серийный корпус: длинный острый нос, дельта-
 * крыло с поднятыми законцовками, спаренные гондолы и два наклонных киля. Геометрия —
 * НЕ процедурная, а загруженный меш (`aurora_one.glb`), поэтому корпус живёт как обычная
 * запись каталога, а рендер сам знает по id, что грузить сетку, а не собирать из примитивов.
 */
export const AURORA_ONE: Chassis = {
  id: 'aurora_one',
  name: 'Аврора One',
  class: 3,
  baseMass: 8,
  baseHull: 225,
  cargoCapacity: 22,
  auxCapacity: 100,
  radius: 12,
  inertiaFactor: 1.0,
  assistLateralDamp: 1.25,
  assistSpeedDamp: 0.35,
  hardpoints: [
    // Силуэт иной, чем у Мк III: пушки садим на дельта-крыло и в острый нос. Координаты дул —
    // в метрах модельного пространства (нос −Z, размах ±X), согласованы с масштабом меша в ships.ts.
    { offset: [0, 0.2, -2], kind: 'gun', maxClass: 2, nozzles: [[-6.0, 0.2, -2], [6.0, 0.2, -2]] },
    { offset: [0, 0.1, 0.5], kind: 'gun', maxClass: 3, nozzles: [[-9.5, 0.1, 0.5], [9.5, 0.1, 0.5]] },
    { offset: [0, -0.2, -12.5], kind: 'gun', maxClass: 3, nozzles: [[0, -0.2, -12.5]] },
    { offset: [-5.0, -0.8, 3.0], kind: 'pylon', maxClass: 1 },
    { offset: [5.0, -0.8, 3.0], kind: 'pylon', maxClass: 1 },
  ],
  slots: [
    { kind: 'engine', maxClass: 3 },
    { kind: 'thrusters', maxClass: 3 },
    { kind: 'shield', maxClass: 3 },
    { kind: 'armour', maxClass: 2 },
    { kind: 'armour', maxClass: 2 },
    { kind: 'cargo', maxClass: 3 },
    { kind: 'cargo', maxClass: 2 },
    { kind: 'hyperdrive', maxClass: 3 },
    { kind: 'aux', maxClass: 3 },
  ],
  cost: 82_000,
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
  hardpoints: AURORA_ONE.hardpoints.filter((hardpoint) => hardpoint.kind !== 'pylon'),
}

/**
 * Истребители из внешних мешей (Meshy GLB). Геометрия — не процедура, а загруженная сетка
 * со своими текстурами (рендер знает по id из реестра GLB_HULLS). В домене — обычные записи
 * каталога: единая раскладка хардпоинтов (спаренная пушка + два пилона), разнятся статами.
 * Дула — приближённо на крыле; уточним по факту силуэта.
 */
const FIGHTER_HARDPOINTS: Chassis['hardpoints'] = [
  { offset: [0, 0, -2], kind: 'gun', maxClass: 2, nozzles: [[-3.0, 0, -2], [3.0, 0, -2]] },
  { offset: [-3.2, -0.5, 2.5], kind: 'pylon', maxClass: 1 },
  { offset: [3.2, -0.5, 2.5], kind: 'pylon', maxClass: 1 },
]
const FIGHTER_SLOTS: Chassis['slots'] = [
  { kind: 'engine', maxClass: 3 },
  { kind: 'thrusters', maxClass: 3 },
  { kind: 'shield', maxClass: 2 },
  { kind: 'armour', maxClass: 2 },
  { kind: 'cargo', maxClass: 1 },
  { kind: 'hyperdrive', maxClass: 2 },
  { kind: 'aux', maxClass: 2 },
]

/** «Гермес» — лёгкий скороход: мало брони, но вёрткий. */
export const HERMES: Chassis = {
  id: 'hermes', name: 'Гермес', class: 2, baseMass: 5, baseHull: 95, cargoCapacity: 12, auxCapacity: 100,
  radius: 8, inertiaFactor: 0.78, assistLateralDamp: 1.35, assistSpeedDamp: 0.35,
  hardpoints: FIGHTER_HARDPOINTS, slots: FIGHTER_SLOTS, cost: 60_000,
}

/** «Персей» — сбалансированный перехватчик. */
export const PERSEUS: Chassis = {
  id: 'perseus', name: 'Персей', class: 2, baseMass: 6, baseHull: 120, cargoCapacity: 14, auxCapacity: 100,
  radius: 9, inertiaFactor: 0.88, assistLateralDamp: 1.2, assistSpeedDamp: 0.35,
  hardpoints: FIGHTER_HARDPOINTS, slots: FIGHTER_SLOTS, cost: 68_000,
}

/** «Пегас» — вёрткий, с чуть большим трюмом. */
export const PEGASUS: Chassis = {
  id: 'pegasus', name: 'Пегас', class: 2, baseMass: 6, baseHull: 110, cargoCapacity: 16, auxCapacity: 100,
  radius: 9, inertiaFactor: 0.82, assistLateralDamp: 1.25, assistSpeedDamp: 0.35,
  hardpoints: FIGHTER_HARDPOINTS, slots: FIGHTER_SLOTS, cost: 66_000,
}

/** «Орион» — тяжёлый истребитель: крепче, но вальяжнее. */
export const ORION: Chassis = {
  id: 'orion', name: 'Орион', class: 3, baseMass: 8, baseHull: 170, cargoCapacity: 18, auxCapacity: 100,
  radius: 10, inertiaFactor: 0.98, assistLateralDamp: 1.1, assistSpeedDamp: 0.35,
  hardpoints: FIGHTER_HARDPOINTS, slots: FIGHTER_SLOTS, cost: 78_000,
}

/** «Тесей» — ещё один лёгкий истребитель (GLB-меш), на общей раскладке. */
export const THESEUS: Chassis = {
  id: 'theseus', name: 'Тесей', class: 2, baseMass: 5, baseHull: 105, cargoCapacity: 13, auxCapacity: 100,
  radius: 8, inertiaFactor: 0.8, assistLateralDamp: 1.3, assistSpeedDamp: 0.35,
  hardpoints: FIGHTER_HARDPOINTS, slots: FIGHTER_SLOTS, cost: 62_000,
}

/**
 * «Атлас» — корабль поколений: тяжёлый ковчег, не истребитель. Своя раскладка: медлительный,
 * толстошкурый, с огромным трюмом. Дула по бортам — оборона, а не охота. Габарит крупнее
 * прочих (в рендере scale выше), потому смещения дул разнесены шире.
 */
const ATLAS_HARDPOINTS: Chassis['hardpoints'] = [
  { offset: [0, 0, -3], kind: 'gun', maxClass: 3, nozzles: [[-6.0, 0, -3], [6.0, 0, -3]] },
  { offset: [0, 0, 0], kind: 'gun', maxClass: 3, nozzles: [[-9.0, 0, 0], [9.0, 0, 0]] },
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

export const CHASSIS_CATALOGUE: readonly Chassis[] = [
  SPIRITUS_SANCTUS,
  AURORA_ONE,
  HERMES,
  PERSEUS,
  PEGASUS,
  ORION,
  THESEUS,
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
  ],
  cost: 9_000,
}
