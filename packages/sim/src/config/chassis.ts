import type { Chassis } from '../domain/loadout'

/**
 * Каталог корпусов. Новый корабль = запись здесь + фабрика геометрии в слое рендера.
 * Симуляцию трогать не нужно.
 */

export const COBRA_MK3: Chassis = {
  id: 'cobra_mk3',
  name: 'Cobra Mk III',
  baseMass: 8, // т, пустой
  baseHull: 90,
  /** м. Кобра — корабль метров 25 в длину; сфера ~половина размаха.
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
  // Компактный: поворачивается легче «Кобры» при той же массе.
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

export const CHASSIS_CATALOGUE: readonly Chassis[] = [COBRA_MK3, SIDEWINDER]

export function findChassis(id: string): Chassis | null {
  return CHASSIS_CATALOGUE.find((c) => c.id === id) ?? null
}
