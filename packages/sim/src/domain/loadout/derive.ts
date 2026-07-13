import { SHOP } from '../../config/station'
import { AUX_POWER } from '../../config/weapons'
import { clamp } from '../../core/math'
import type { ShipTuning } from '../flight/types'
import type { Hardpoint } from './chassis'
import {
  dryMass,
  findArmour,
  findCargoRacks,
  findCloak,
  findMielophone,
  findEngine,
  findHyperdrive,
  findShield,
  findThrusters,
  type Loadout,
} from './loadout'
import type { WeaponModule } from './modules'

/**
 * Сборка корабля из модулей. Это единственное место, где начинка превращается
 * в характеристики: физика про модули не знает и знать не должна.
 *
 * Все компромиссы прокачки возникают здесь сами собой, из массы:
 *   ускорение = тяга / масса,   угловое ускорение = момент / (масса · inertiaFactor).
 * Поставил тяжёлый щит — потерял манёвренность. Это посчитано, а не назначено.
 */

export interface WeaponMount {
  hardpoint: Hardpoint
  weapon: WeaponModule
  /** Индекс в `loadout.weapons` — по нему рендер находит ствол. */
  index: number
}

export interface HullSpec {
  hull: number
  shield: number
  shieldRegen: number
  shieldRegenDelay: number
  radius: number
}

/**
 * Батареи. Их ДВЕ: главная (реактор двигателя — полёт, форсаж, оружие) и доп-отсека
 * (аукс — бомба, ПРО, маскировка). Раздельные пулы: расход гаджетов не сажает главную.
 */
export interface PowerSpec {
  capacity: number
  regen: number
  /** Ёмкость батареи доп-отсека, ед. */
  auxCapacity: number
  /** Восполнение батареи доп-отсека, ед/с. */
  auxRegen: number
}

export interface ShipSpec {
  tuning: ShipTuning
  hull: HullSpec
  power: PowerSpec
  mounts: WeaponMount[]
  /** Полная масса со снаряжением и грузом, т. */
  mass: number
  cargoCapacity: number
  /** Дальность прыжка, св. лет. Ноль — привода нет, межзвёздный перелёт невозможен. */
  jumpRange: number
  /** Расход батарей на маскировку, ед/с. Ноль — поля нет, корабль виден всегда. */
  cloakDrain: number
  /** Стоит ли миелофон: без него борт не растёт (право на масштаб — от устройства). */
  hasMielophone: boolean
}

/** Двигатель без корабля не бывает: эти значения означают «летать нельзя». */
const DEAD_ENGINE = { thrust: 0, maxSpeed: 0, optimalMass: 1, boostMult: 1, energy: 0, energyRegen: 0 }
const DEAD_THRUSTERS = {
  lateralThrust: 0,
  torque: [0, 0, 0] as const,
  maxRate: [0, 0, 0] as const,
  angDamp: 1,
}

/**
 * Разовые прокачки СОБСТВЕННЫХ х-к рамы. Каждую из трёх осей — HP, грузоподъёмность,
 * аукс-ёмкость — можно усилить ОДИН раз на +25% (см. `SHOP.HULL_STAT_STEP`). Не уровень
 * без предела, а три независимых тумблера: рама либо усилена по оси, либо нет.
 */
export interface HullUpgrades {
  hull: boolean
  cargo: boolean
  aux: boolean
}

/** Заводская рама — ни одна ось не усилена. */
export const NO_HULL_UPGRADES: HullUpgrades = { hull: false, cargo: false, aux: false }

/** Множитель оси: усилена → +HULL_STAT_STEP (+25%), иначе 1. */
function statMult(on: boolean): number {
  return on ? 1 + SHOP.HULL_STAT_STEP : 1
}

/**
 * @param cargoMass Масса груза в трюме, т. Меняется в полёте — пересобирай спецификацию
 *                  на событие загрузки/выгрузки, а не каждый кадр.
 * @param up Разовые прокачки собственных х-к рамы (HP / грузоподъёмность / аукс). Каждая
 *           усиленная ось множит СВОЮ базовую х-ку на +25%; армор и обвес не трогают.
 */
export function deriveShipSpec(loadout: Loadout, cargoMass = 0, up: HullUpgrades = NO_HULL_UPGRADES): ShipSpec {
  const { chassis } = loadout
  const engine = findEngine(loadout) ?? DEAD_ENGINE
  const rcs = findThrusters(loadout) ?? DEAD_THRUSTERS
  const shield = findShield(loadout)

  const mass = dryMass(loadout) + cargoMass
  const inertia = mass * chassis.inertiaFactor

  // Перегруз режет потолок скорости, но не отменяет полёт.
  // Границы важны: без нижней перегруженный корабль встанет намертво.
  const massFactor = clamp((engine.optimalMass / mass) ** 0.35, 0.55, 1.15)

  const tuning: ShipTuning = {
    MASS: mass,
    THRUST: engine.thrust,
    MAX_SPEED: engine.maxSpeed * massFactor,
    STRAFE_THRUST: rcs.lateralThrust,

    PITCH_RATE: rcs.maxRate[0],
    YAW_RATE: rcs.maxRate[1],
    ROLL_RATE: rcs.maxRate[2],

    // Вот здесь масса и становится манёвренностью.
    PITCH_ACCEL: safeAccel(rcs.torque[0], inertia),
    YAW_ACCEL: safeAccel(rcs.torque[1], inertia),
    ROLL_ACCEL: safeAccel(rcs.torque[2], inertia),

    ANG_DAMP: rcs.angDamp,
    ASSIST_LATERAL_DAMP: chassis.assistLateralDamp,
    ASSIST_SPEED_DAMP: chassis.assistSpeedDamp,
  }

  // Прокачка HP растит СОБСТВЕННУю прочность рамы; броня — своя ось, её не трогаем.
  let hullPoints = Math.round(chassis.baseHull * statMult(up.hull))
  for (const a of findArmour(loadout)) hullPoints += a.hull

  const hull: HullSpec = {
    hull: hullPoints,
    shield: shield?.capacity ?? 0,
    shieldRegen: shield?.regen ?? 0,
    shieldRegenDelay: shield?.regenDelay ?? Infinity,
    radius: chassis.radius,
  }

  const mounts: WeaponMount[] = []
  loadout.weapons.forEach((weapon, index) => {
    const hardpoint = chassis.hardpoints[index]
    if (weapon && hardpoint) mounts.push({ hardpoint, weapon, index })
  })

  const power: PowerSpec = {
    capacity: engine.energy,
    regen: engine.energyRegen,
    // Ёмкость доп-отсека — свойство корпуса; своя разовая прокачка её растит.
    auxCapacity: Math.round(chassis.auxCapacity * statMult(up.aux)),
    auxRegen: AUX_POWER.REGEN,
  }

  // Грузоподъёмность корпуса — массовый бюджет под нагрузку. Оборудование ест его своей
  // массой (без пустой массы корпуса); контейнеры добавляют вместимость (их `capacity` ≈
  // 10× массы); остаток — сколько тонн товара влезет. Пустеет до нуля, но не уходит в минус.
  const equipmentMass = mass - cargoMass - chassis.baseMass // = dryMass − baseMass = обвес
  let cargoCapacity = chassis.cargoCapacity * statMult(up.cargo) - equipmentMass
  for (const rack of findCargoRacks(loadout)) cargoCapacity += rack.capacity
  // Трюм считается целыми тоннами (товар — целые единицы): округляем ВНИЗ, не в минус.
  cargoCapacity = Math.max(0, Math.floor(cargoCapacity))

  return {
    tuning, hull, power, mounts, mass, cargoCapacity,
    jumpRange: findHyperdrive(loadout)?.jumpRange ?? 0,
    cloakDrain: findCloak(loadout)?.drain ?? 0,
    hasMielophone: findMielophone(loadout) != null,
  }
}

function safeAccel(torque: number, inertia: number): number {
  return inertia > 1e-6 ? torque / inertia : 0
}

export function boostMult(loadout: Loadout): number {
  return findEngine(loadout)?.boostMult ?? 1
}
