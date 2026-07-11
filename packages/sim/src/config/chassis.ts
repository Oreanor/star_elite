import type { Chassis } from '../domain/loadout'

/**
 * Каталог корпусов. Новый корабль = запись здесь + фабрика геометрии в слое рендера.
 * Симуляцию трогать не нужно.
 */

export const AURORA_MK3: Chassis = {
  id: 'aurora_mk3',
  name: 'Аврора Мк III',
  baseMass: 8, // т, пустой
  baseHull: 90,
  /** м. Аврора — корабль метров 25 в длину; сфера ~половина размаха.
   *  Это не косметика: угловой размер цели решает, возможно ли попасть вообще. */
  radius: 12,
  inertiaFactor: 1.0,
  assistLateralDamp: 1.25, // 1/с
  assistSpeedDamp: 0.35,
  hardpoints: [
    { offset: [-1.9, -0.25, -1.6], kind: 'gun', maxClass: 2 },
    { offset: [1.9, -0.25, -1.6], kind: 'gun', maxClass: 2 },
    // Четыре пилона ПОД крыльями. Боезапас пилона задаёт сама ракета (`ammo`),
    // и пуск идёт по одной: пустой пилон просто нечем стрелять.
    //
    // Подвес опущен до −1.3 м: на −0.6 верхнее перо стабилизатора выходило
    // сквозь обшивку крыла. Пилон обязан висеть ниже плоскости, а не в ней.
    { offset: [-5.2, -1.3, 3.6], kind: 'pylon', maxClass: 1 },
    { offset: [5.2, -1.3, 3.6], kind: 'pylon', maxClass: 1 },
    { offset: [-8.0, -1.2, 5.2], kind: 'pylon', maxClass: 1 },
    { offset: [8.0, -1.2, 5.2], kind: 'pylon', maxClass: 1 },
  ],
  slots: [
    { kind: 'engine', maxClass: 3 },
    { kind: 'thrusters', maxClass: 3 },
    { kind: 'shield', maxClass: 3 },
    { kind: 'armour', maxClass: 2 },
    { kind: 'armour', maxClass: 2 },
    { kind: 'cargo', maxClass: 3 },
    { kind: 'cargo', maxClass: 2 },
    // Гиперпривод — внутренний модуль, как двигатель. Снял его — и корабль
    // заперт в системе: карта галактики становится атласом, а не маршрутом.
    { kind: 'hyperdrive', maxClass: 3 },
    // Маскировка — тоже внутренний модуль. Слот пустой с завода: поле стоит
    // как четверть корабля, и первым делом его не покупают.
    { kind: 'cloak', maxClass: 3 },
  ],
  cost: 0, // стартовый корабль
}

export const SIDEWINDER: Chassis = {
  id: 'sidewinder',
  name: 'Sidewinder',
  baseMass: 6,
  baseHull: 40,
  /** м. Мелкий истребитель: труднее попасть, но и брони нет. */
  radius: 9,
  // Компактный: поворачивается легче «Авроры» при той же массе.
  inertiaFactor: 0.85,
  assistLateralDamp: 1.1,
  assistSpeedDamp: 0.35,
  hardpoints: [
    { offset: [-1.5, -0.2, -1.2], kind: 'gun', maxClass: 1 },
    { offset: [1.5, -0.2, -1.2], kind: 'gun', maxClass: 1 },
    // Один пилон: у главаря там ракета, у рядового пирата пусто.
    { offset: [-3.8, -0.4, 2.6], kind: 'pylon', maxClass: 1 },
  ],
  slots: [
    { kind: 'engine', maxClass: 2 },
    { kind: 'thrusters', maxClass: 2 },
    { kind: 'shield', maxClass: 2 },
    { kind: 'armour', maxClass: 1 },
    { kind: 'cargo', maxClass: 1 },
  ],
  cost: 32000,
}

/**
 * Тяжёлый грузовик. Не боевой корабль: он возит тонны и еле ворочается.
 *
 * Неповоротливость — не штраф в цифре урона, а следствие честной физики: большая
 * масса и огромный момент инерции (inertiaFactor 5) при слабых гражданских
 * маневровых дают угловое ускачение вчетверо ниже истребителя. Он не увернётся
 * ни от кого — потому и летает под прикрытием. Живучий корпус нужен затем же:
 * пока эскорт разбирается с налётчиком, туша должна выстоять.
 *
 * Четыре грузовых слота и один защитный ствол по борту: это мишень с трюмом,
 * а не канонерка. Сбитый, он высыпает весь груз — ради него на него и нападают.
 */
export const LARGE_FREIGHTER: Chassis = {
  id: 'freighter',
  name: 'Грузовик «Тип-9»',
  baseMass: 90, // т, пустой — на порядок тяжелее истребителя
  baseHull: 320,
  /** м. Втрое длиннее «Авроры»: тушу видно издалека, и попасть по ней нетрудно. */
  radius: 34,
  inertiaFactor: 5.0,
  assistLateralDamp: 0.7, // 1/с — тяжёлую баржу лётный компьютер гасит вяло
  assistSpeedDamp: 0.3,
  hardpoints: [
    // Пара оборонительных стволов по бортам. Отбиться не отобьётся, но огрызается.
    { offset: [-3.4, -0.6, -2.0], kind: 'gun', maxClass: 2 },
    { offset: [3.4, -0.6, -2.0], kind: 'gun', maxClass: 2 },
  ],
  slots: [
    { kind: 'engine', maxClass: 2 },
    { kind: 'thrusters', maxClass: 1 }, // только гражданские: вот откуда вялый разворот
    { kind: 'shield', maxClass: 3 },
    { kind: 'armour', maxClass: 3 },
    // Четыре трюма: грузовик тем и живёт. С полными контейнерами трюм за две сотни тонн.
    { kind: 'cargo', maxClass: 3 },
    { kind: 'cargo', maxClass: 3 },
    { kind: 'cargo', maxClass: 3 },
    { kind: 'cargo', maxClass: 3 },
    { kind: 'hyperdrive', maxClass: 3 },
  ],
  cost: 210000,
}

export const CHASSIS_CATALOGUE: readonly Chassis[] = [AURORA_MK3, SIDEWINDER, LARGE_FREIGHTER]

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
  name: 'БПЛА «Оса»',
  baseMass: 0.9,
  baseHull: 22,
  /** м. Втрое мельче «Сайдвиндера»: попасть в него — отдельная задача. */
  radius: 3,
  inertiaFactor: 0.4,
  assistLateralDamp: 1.4,
  assistSpeedDamp: 0.4,
  hardpoints: [{ offset: [0, 0, -0.8], kind: 'gun', maxClass: 1 }],
  slots: [
    { kind: 'engine', maxClass: 1 },
    { kind: 'thrusters', maxClass: 1 },
  ],
  cost: 0,
}
