import { MIELOPHONE } from '../../config/mielophone'
import { findModule } from '../../config/modules'
import { SERVICE } from '../../config/station'
import { clamp } from '../../core/math'
import { type ShipModule, type WeaponModule, isArmour, isCargo, isCloak, isDrone, isEngine, isHyperdrive, isLaser, isMissile, isShield, isThrusters } from '../loadout'
import { ShipEntity, World } from '../world/entities'
import { localSettlement } from './trade'
/**
 * Состояние ЭКЗЕМПЛЯРА модуля и его места на корабле: поломка, уровень прокачки, главная
 * характеристика, где он стоит и чем его подменить; умеет ли станция обслужить его класс.
 *
 * Нижний слой станции: на него опираются и ремонт, и прокачка, и магазин. Своего знания о
 * сделках здесь нет — поэтому ни один из них не тянет другой по кругу.
 */

/**
 * Идентификатор характеристики — НЕ слово. Домен языка не знает: перевод «щита» в
 * «ЩИТ»/«SHLD» и подстановку единиц делает слой интерфейса. Иначе перевод пришлось
 * бы тащить в симуляцию, которой стоять на сервере без всякого экрана.
 */
export type StatKey =
  | 'shield' | 'hull' | 'speed' | 'turn' | 'cargo' | 'jump'
  | 'thrust' | 'damage' | 'ammo' | 'drain' | 'scale' | 'mass'

export function moduleStat(m: ShipModule): { key: StatKey; value: number } {
  switch (m.kind) {
    case 'engine': return { key: 'thrust', value: m.thrust }
    case 'thrusters': return { key: 'turn', value: m.maxRate[2] }
    case 'shield': return { key: 'shield', value: m.capacity }
    case 'armour': return { key: 'hull', value: m.hull }
    case 'laser': return { key: 'damage', value: m.damage }
    case 'missile': return { key: 'ammo', value: m.ammo }
    case 'drone': return { key: 'ammo', value: m.ammo }
    case 'cargo': return { key: 'cargo', value: m.capacity }
    case 'hyperdrive': return { key: 'jump', value: m.jumpRange }
    case 'cloak': return { key: 'drain', value: m.drain }
    // Миелофон: своей числовой характеристики нет (темп и пределы в config/mielophone).
    // Показываем темп роста — единственное осмысленное число артефакта.
    case 'mielophone': return { key: 'scale', value: MIELOPHONE.GROW_RATE }
    // Аукс-устройства (ECM/бомба/скуп) числовой характеристики не имеют — показываем
    // массу как честный скаляр (меньше — лучше). Параметры срабатывания живут в config.
    case 'ecm':
    case 'bomb':
    case 'scoop': return { key: 'mass', value: m.mass }
  }
}

/**
 * Ассортимент станции этой системы. Детерминирован из зерна и индекса системы,
 * как и цены: два пилота в одной системе видят одну витрину, ничего не пересылая.
 * Оттого магазин синхронизируется по сети даром. Решение по каждому модулю —
 * независимый бросок от собственного зерна, поэтому список стабилен между вызовами.
 */
/** Минимальный тех-уровень мира, чтобы держать/обслуживать модуль этого КЛАССА. */
export function minTechForClass(cls: 1 | 2 | 3 | 4): number {
  return SERVICE.MIN_TECH_BY_CLASS[cls]
}

/**
 * Тянет ли ЭТОТ мир такой класс железа — и продать, и обслужить. Развитость поселения
 * это технологический потолок: класс 4 (вершина, сюда же ремонт инструментов бога)
 * доступен лишь на тех ≥ 12, а дикарям не собрать и класс 2. Одна дверь для витрины и
 * для сервиса, чтобы «где куплю» и «где починю» отвечали одинаково.
 */
export function canServiceHere(world: World, module: ShipModule): boolean {
  return localSettlement(world).techLevel >= minTechForClass(module.class)
}

export function hashModuleId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Где стоит модуль: точка подвески, внутренний слот, или нигде (уже снят). */
export function locateInstalled(ship: ShipEntity, module: ShipModule): { weapon: number } | { internal: number } | null {
  const wi = ship.loadout.weapons.findIndex((w) => w === module)
  if (wi >= 0) return { weapon: wi }
  const ii = ship.loadout.internals.indexOf(module)
  if (ii >= 0) return { internal: ii }
  return null
}

/** Подменить установленный модуль его новым экземпляром НА ТОМ ЖЕ месте (клон-правка). */
export function replaceInstalled(ship: ShipEntity, module: ShipModule, next: ShipModule): void {
  const at = locateInstalled(ship, module)
  if (!at) return
  if ('weapon' in at) ship.loadout.weapons[at.weapon] = next as WeaponModule
  else ship.loadout.internals[at.internal] = next
}

/** Поломка детали, доля: 0 — исправна, 1 — молчит. */
export function moduleFault(module: ShipModule): number {
  return module.fault ?? 0
}

/** Накопленная прибавка модуля, доля к стоку: 0 — заводской, 0.5 — «+50%». */
export function upgradeLevel(module: ShipModule): number {
  return module.upgrade ?? 0
}

/**
 * Множит характеристики модуля от СТОКА: clone.field = base.field × (1+level).
 * От стока, а не от текущего значения, — чтобы показанное «+50%» точно равнялось
 * правде, а не накопленной дроби с округлениями. Момент и лимиты множатся целиком:
 * разворот растёт по всем осям. У маскировки растёт не расход, а экономичность —
 * потому делится, а не множится: меньше жрёт батарей значит лучше.
 */
export function scaleToBase(m: ShipModule, base: ShipModule, k: number): void {
  if (isEngine(m) && isEngine(base)) { m.thrust = base.thrust * k; m.maxSpeed = base.maxSpeed * k; return }
  if (isThrusters(m) && isThrusters(base)) {
    m.torque = [base.torque[0] * k, base.torque[1] * k, base.torque[2] * k]
    m.maxRate = [base.maxRate[0] * k, base.maxRate[1] * k, base.maxRate[2] * k]
    return
  }
  if (isShield(m) && isShield(base)) { m.capacity = base.capacity * k; m.regen = base.regen * k; return }
  if (isArmour(m) && isArmour(base)) { m.hull = base.hull * k; return }
  if (isLaser(m) && isLaser(base)) { m.damage = base.damage * k; return }
  // Ракета — расходник: её не чинят, но пусковую УЛУЧШАЮТ бо́льшим боезапасом (не уроном).
  if (isMissile(m) && isMissile(base)) { m.ammo = Math.round(base.ammo * k); return }
  if (isDrone(m) && isDrone(base)) { m.ammo = Math.round(base.ammo * k); return }
  if (isCargo(m) && isCargo(base)) { m.capacity = Math.round(base.capacity * k); return }
  if (isHyperdrive(m) && isHyperdrive(base)) { m.jumpRange = base.jumpRange * k; return }
  if (isCloak(m) && isCloak(base)) { m.drain = base.drain / k }
}

/**
 * Общий множитель характеристики экземпляра: прокачка усиливает, поломка ослабляет.
 * base × (1+upgrade) × (1−fault). Печём ОБА через один `scaleToBase` от стока —
 * иначе прокачка сломанной детали или поломка прокачанной считались бы друг от друга
 * с накоплением ошибок. Поломка ракеты/контейнера не бывает (fault=0) — множитель их не трогает.
 */
export function combinedScale(m: ShipModule): number {
  return (1 + (m.upgrade ?? 0)) * (1 - (m.fault ?? 0))
}

/** Собственный прокачанный экземпляр модуля. Конфиг не трогаем — он общий на всех. */
export function withUpgrade(module: ShipModule, level: number): ShipModule {
  const base = findModule(module.id) ?? module
  const clone: ShipModule = { ...module, upgrade: level }
  // От стока с УЧЁТОМ уже накопленной поломки: прокачка чинёного не «лечит» его.
  scaleToBase(clone, base, combinedScale(clone))
  return clone
}

/**
 * Собственный экземпляр модуля с изменённой ПОЛОМКОЙ (в бою — от попадания, у мастера —
 * при провале/успехе ремонта). Возвращает КЛОН, а не мутирует вход: установленные модули
 * ссылаются прямо на каталог (и `[LASER, LASER]` — один объект дважды), поэтому правка на
 * месте испортила бы сток всем кораблям сразу. Тот же приём, что у `withUpgrade`. Ракету и
 * контейнер сюда не зовут: им ломаться нечем (расходник / ёмкость от поломки не тает).
 */
export function withFault(module: ShipModule, delta: number): ShipModule {
  const base = findModule(module.id) ?? module
  const clone: ShipModule = { ...module, fault: clamp((module.fault ?? 0) + delta, 0, 1) }
  scaleToBase(clone, base, combinedScale(clone))
  return clone
}
