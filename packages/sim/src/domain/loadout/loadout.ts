import type { Chassis } from './chassis'
import {
  isArmour,
  isBomb,
  isCargo,
  isCloak,
  isEcm,
  isEngine,
  isHyperdrive,
  isMielophone,
  isScoop,
  isShield,
  isThrusters,
  slotCategoryOf,
  type ArmourModule,
  type CargoModule,
  type CloakModule,
  type EngineModule,
  type HyperdriveModule,
  type MielophoneModule,
  type ShieldModule,
  type ShipModule,
  type ThrusterModule,
  type WeaponModule,
} from './modules'

/**
 * Что на корабле стоит прямо сейчас. Оружие индексируется по hardpoint'ам корпуса:
 * `weapons[i]` висит на `chassis.hardpoints[i]`, null — точка пустая.
 */
export interface Loadout {
  chassis: Chassis
  /** Внутренние модули. Порядок не важен — слоты проверяются при установке. */
  internals: ShipModule[]
  weapons: (WeaponModule | null)[]
}

export function createLoadout(chassis: Chassis, internals: ShipModule[], weapons: (WeaponModule | null)[]): Loadout {
  return {
    chassis,
    internals: [...internals],
    // Нормализуем длину под число точек подвески: рендер и стрельба ходят по индексам.
    weapons: chassis.hardpoints.map((_, i) => weapons[i] ?? null),
  }
}

/** Двигатель и маневровые обязательны — без них корабль не летает. */
export function findEngine(l: Loadout): EngineModule | null {
  return l.internals.find(isEngine) ?? null
}
export function findThrusters(l: Loadout): ThrusterModule | null {
  return l.internals.find(isThrusters) ?? null
}
export function findShield(l: Loadout): ShieldModule | null {
  return l.internals.find(isShield) ?? null
}
export function findArmour(l: Loadout): ArmourModule[] {
  return l.internals.filter(isArmour)
}
export function findCargoRacks(l: Loadout): CargoModule[] {
  return l.internals.filter(isCargo)
}

/** Маскировки может не быть: это дорогая роскошь, а не часть корабля. */
export function findCloak(l: Loadout): CloakModule | null {
  return l.internals.find(isCloak) ?? null
}

/** Без привода межзвёздный прыжок невозможен вовсе — это правило, а не штраф. */
export function findHyperdrive(l: Loadout): HyperdriveModule | null {
  return l.internals.find(isHyperdrive) ?? null
}

/** Миелофона может не быть: без него борт не растёт (см. `stepScale`). Редкий артефакт. */
export function findMielophone(l: Loadout): MielophoneModule | null {
  return l.internals.find(isMielophone) ?? null
}

/**
 * Аукс-способности гейтятся НАЛИЧИЕМ модуля — для всех, и игрока, и ИИ (принцип
 * «неотличимы»): без устройства нельзя ни глушить ракеты, ни бить бомбой.
 */
export function hasEcm(l: Loadout): boolean {
  return l.internals.some(isEcm)
}
export function hasBomb(l: Loadout): boolean {
  return l.internals.some(isBomb)
}
export function hasScoop(l: Loadout): boolean {
  return l.internals.some(isScoop)
}

/** Снаряжённая масса: корпус + все модули. Груз добавляется отдельно, он меняется в полёте. */
export function dryMass(l: Loadout): number {
  let m = l.chassis.baseMass
  for (const mod of l.internals) m += mod.mass
  for (const w of l.weapons) if (w) m += w.mass
  return m
}

export function totalCost(l: Loadout): number {
  let c = l.chassis.cost
  for (const mod of l.internals) c += mod.cost
  for (const w of l.weapons) if (w) c += w.cost
  return c
}

/** Все установленные модули одним списком — нужно трофеям и торговле. */
export function allModules(l: Loadout): ShipModule[] {
  const out: ShipModule[] = [...l.internals]
  for (const w of l.weapons) if (w) out.push(w)
  return out
}

export type InstallError = 'no-free-slot' | 'class-too-large' | 'wrong-kind' | 'no-hardpoint'

/** Ракета живёт на пилоне, ствол — в орудийной точке. Перепутать нельзя. */
function fits(hardpointKind: 'gun' | 'pylon', weaponKind: WeaponModule['kind']): boolean {
  // Пилон несёт и ракету, и контейнер БПЛА: и то и другое сходит с подвески.
  return hardpointKind === 'pylon' ? weaponKind !== 'laser' : weaponKind === 'laser'
}

/** Проверка перед установкой. Возвращает null, если модуль влезает. */
export function canInstallInternal(l: Loadout, mod: ShipModule): InstallError | null {
  // Категория, а НЕ вид: аукс-слот делят разные устройства, и занятость считается
  // по всей категории. Иначе бомба «не увидит» клоак, занявший ту же аукс-ячейку.
  const cat = slotCategoryOf(mod.kind)
  const candidates = l.chassis.slots.filter((s) => s.kind === cat)
  if (candidates.length === 0) return 'wrong-kind'

  // Класс гейтит корпус, не слот (груз — бесклассовый, class 1, лезет всегда).
  if (mod.class > l.chassis.class) return 'class-too-large'

  const occupied = l.internals.filter((m) => slotCategoryOf(m.kind) === cat).length
  if (occupied >= candidates.length) return 'no-free-slot'
  return null
}

export function canInstallWeapon(l: Loadout, mod: WeaponModule, hardpointIndex: number): InstallError | null {
  const hp = l.chassis.hardpoints[hardpointIndex]
  if (!hp) return 'no-hardpoint'
  if (!fits(hp.kind, mod.kind)) return 'wrong-kind'
  if (mod.class > l.chassis.class) return 'class-too-large'
  return null
}

/** Индексы точек подвески заданного вида. Нужно рендеру: он рисует ракеты на пилонах. */
export function hardpointIndices(l: Loadout, kind: 'gun' | 'pylon'): number[] {
  const out: number[] = []
  l.chassis.hardpoints.forEach((hp, i) => {
    if (hp.kind === kind) out.push(i)
  })
  return out
}
