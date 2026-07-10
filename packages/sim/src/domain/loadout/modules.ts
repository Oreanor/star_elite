/**
 * Модули корабля. Каждый — данные, а не код: новый двигатель это новая запись
 * в каталоге, а не ветвление в симуляции.
 *
 * Общий у всех — `mass`. Именно через неё модули честно связаны с физикой:
 * тяжёлый щит уменьшает и линейное ускорение (a = F/m), и угловое (ε = M/I).
 * Апгрейд всегда есть компромисс, и он не нарисован, а посчитан.
 */

export type ModuleKind =
  | 'engine'
  | 'thrusters'
  | 'shield'
  | 'armour'
  | 'laser'
  | 'missile'
  | 'cargo'
  | 'hyperdrive'

export interface ModuleBase {
  /** Стабильный идентификатор для сохранений и торговли. */
  id: string
  name: string
  kind: ModuleKind
  /** Класс 1..4: определяет, в какой слот влезет. */
  class: 1 | 2 | 3 | 4
  /** Масса, т. */
  mass: number
  /** Цена, кредиты. */
  cost: number
  /** Шанс уцелеть при разрушении корабля-носителя, 0..1. */
  salvageChance: number
}

export interface EngineModule extends ModuleBase {
  kind: 'engine'
  /** Тяга, кН. Ускорение = THRUST / масса — считается, а не задаётся. */
  thrust: number
  /** Потолок скорости при массе `optimalMass`, м/с. */
  maxSpeed: number
  /** Масса, на которую двигатель рассчитан. Перегруз режет потолок скорости. */
  optimalMass: number
  /** Множитель тяги и потолка на форсаже. */
  boostMult: number
  /**
   * Ёмкость батарей, ед. Двигатель здесь и реактор: отдельный модуль питания
   * добавил бы слот, но не добавил бы ни одного решения игроку.
   */
  energy: number
  /** Восстановление батарей, ед/с. */
  energyRegen: number
}

export interface ThrusterModule extends ModuleBase {
  kind: 'thrusters'
  /**
   * Боковая тяга, кН. Ею уходят с линии огня и с курса ракеты («бочка»).
   * Апгрейд маневровых улучшает уклонение — считается из массы, не назначается.
   */
  lateralThrust: number
  /** Момент маневровых по осям [тангаж, рыскание, крен], кН·м. */
  torque: readonly [number, number, number]
  /** Ограничение угловой скорости лётным компьютером, рад/с. */
  maxRate: readonly [number, number, number]
  /** Демпфирование при отпущенном управлении, 1/с. */
  angDamp: number
}

export interface ShieldModule extends ModuleBase {
  kind: 'shield'
  capacity: number
  /** Восстановление, ед/с. */
  regen: number
  /** Пауза после попадания, с. */
  regenDelay: number
}

export interface ArmourModule extends ModuleBase {
  kind: 'armour'
  /** Прибавка к прочности корпуса. */
  hull: number
}

export interface LaserModule extends ModuleBase {
  kind: 'laser'
  damage: number
  range: number
  /** Секунд между выстрелами. */
  cooldown: number
  /** Набор тепла за выстрел; 1.0 — блокировка. */
  heatPerShot: number
  /** Сброс тепла, 1/с. */
  heatCool: number
}

/**
 * Ракета.
 *
 * `turnRate` даёт боковое ускорение v·ω — при 420 м/с и 1.25 рад/с это полсотни g,
 * втрое больше, чем способен выдать любой корабль. Уйти от такой ракеты манёвром
 * НЕЛЬЗЯ, и никакие «бочки» этого не изменят: физика посчитана, а не назначена.
 *
 * Промах даёт `seekerRate` — предел скорости слежения головки. Угловая скорость
 * линии визирования равна v⊥/d и на малой дистанции взлетает: рывок вбок у самого
 * носа ракеты головка отработать не успевает и теряет цель насовсем. Летящий по
 * прямой не срывает наведение никогда — у него v⊥ = 0. Именно поэтому бочка
 * работает, а прямой полёт — нет.
 */
export interface MissileModule extends ModuleBase {
  kind: 'missile'
  ammo: number
  damage: number
  /** Маршевая скорость, м/с. */
  speed: number
  /**
   * Разгон после схода с пилона, с. Ракета отделяется со скоростью носителя,
   * зажигает двигатель и только потом уходит вперёд. Это не украшательство:
   * иначе ракета исчезает в тот же кадр, в который её пустили, и её не видно.
   * Пока идёт разгон, рули неэффективны и наведения нет.
   */
  boostTime: number
  /** Угловая скорость самонаведения, рад/с. Низкая — ракету можно перекрутить. */
  turnRate: number
  /** Предел скорости слежения головки, рад/с. Выше — срыв наведения навсегда. */
  seekerRate: number
  /**
   * Самоликвидация, с. Вместе со `speed` она и есть дальность ракеты, но не по
   * пути, а по СБЛИЖЕНИЮ: убегающая цель вычитает свою скорость. Замер
   * (`scratch/missile-range.ts`): по уходящему на 200 м/с достаём 2.6 км,
   * по висящему — 5 км, по встречному — за 7 км.
   */
  lifetime: number
}

export interface CargoModule extends ModuleBase {
  kind: 'cargo'
  /** Вместимость, тонн груза. */
  capacity: number
}

export interface HyperdriveModule extends ModuleBase {
  kind: 'hyperdrive'
  /**
   * Дальность прыжка, световых лет. Единственная характеристика привода: он либо
   * добивает до звезды, либо нет. Масса у него большая — апгрейд дальности
   * оплачивается манёвренностью, как и всякий другой.
   */
  jumpRange: number
}

export type ShipModule =
  | EngineModule
  | ThrusterModule
  | ShieldModule
  | ArmourModule
  | LaserModule
  | MissileModule
  | CargoModule
  | HyperdriveModule

/** Сужение по виду — вместо `as`, чтобы `any` не понадобился нигде. */
export const isEngine = (m: ShipModule): m is EngineModule => m.kind === 'engine'
export const isThrusters = (m: ShipModule): m is ThrusterModule => m.kind === 'thrusters'
export const isShield = (m: ShipModule): m is ShieldModule => m.kind === 'shield'
export const isArmour = (m: ShipModule): m is ArmourModule => m.kind === 'armour'
export const isLaser = (m: ShipModule): m is LaserModule => m.kind === 'laser'
export const isMissile = (m: ShipModule): m is MissileModule => m.kind === 'missile'
export const isCargo = (m: ShipModule): m is CargoModule => m.kind === 'cargo'
export const isHyperdrive = (m: ShipModule): m is HyperdriveModule => m.kind === 'hyperdrive'

export type WeaponModule = LaserModule | MissileModule
export const isWeapon = (m: ShipModule): m is WeaponModule => isLaser(m) || isMissile(m)
