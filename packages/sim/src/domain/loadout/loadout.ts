import { createLoadout, type Loadout } from '../../config/schema'
import {
  isArmour,
  isBomb,
  isCargo,
  isCloak,
  isEcm,
  isEngine,
  isHyperdrive,
  isMielophone,
  isShield,
  isThrusters,
  type ArmourModule,
  type CargoModule,
  type CloakModule,
  type EcmModule,
  type EngineModule,
  type HyperdriveModule,
  type MielophoneModule,
  type ShieldModule,
  type ShipModule,
  type ThrusterModule,
} from './modules'

// Форма сборки и её конструктор — часть схемы каталога (`config/schema`): они ничего
// не решают, только описывают и нормализуют. Правила ниже — уже домен.
export { createLoadout, type Loadout }

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
/** Установленный модуль ПРО — по нему берут класс (класс задаёт расход импульса). */
export function findEcm(l: Loadout): EcmModule | null {
  return l.internals.find(isEcm) ?? null
}
export function hasBomb(l: Loadout): boolean {
  return l.internals.some(isBomb)
}

/** Снаряжённая масса: корпус + все модули. Груз добавляется отдельно, он меняется в полёте. */
export function dryMass(l: Loadout): number {
  let m = l.chassis.baseMass
  for (const mod of l.internals) m += mod.mass
  for (const w of l.weapons) if (w) m += w.mass
  return m
}

/** Все установленные модули одним списком — нужно трофеям и торговле. */
export function allModules(l: Loadout): ShipModule[] {
  const out: ShipModule[] = [...l.internals]
  for (const w of l.weapons) if (w) out.push(w)
  return out
}

/** Индексы точек подвески заданного вида. Нужно рендеру: он рисует ракеты на пилонах. */
export function hardpointIndices(l: Loadout, kind: 'gun' | 'pylon'): number[] {
  const out: number[] = []
  l.chassis.hardpoints.forEach((hp, i) => {
    if (hp.kind === kind) out.push(i)
  })
  return out
}
