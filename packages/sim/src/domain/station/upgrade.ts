import { SHOP } from '../../config/station'
import { roundMoney } from '../../core/math'
import { removeItem } from '../cargo/hold'
import {
  factoryHullUp,
  hullUpFor,
  isAux,
  type ShipModule,
  type WeaponModule,
} from '../loadout'
import type { ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'
import { canServiceHere, moduleStat, upgradeLevel, withUpgrade } from './moduleState'
import { isCosmic } from '../combat/cosmic'

/**
 * Прокачка: модуля (копией из трюма или деньгами) и собственных характеристик корпуса.
 * Модуль качают ступенями по `SHOP.UPGRADE_STEP` до `SHOP.UPGRADE_MAX_STEPS`, шаги складываются.
 */

/**
 * Сколько ступеней уже вложено — ВЫВОДИТСЯ из уровня, а не хранится рядом: два владельца одного
 * факта расходились бы при любой смене ступени. Старые +75% (три шага по 25%) — это «+15».
 */
export function upgradeSteps(module: ShipModule): number {
  return Math.round(upgradeLevel(module) / SHOP.UPGRADE_STEP)
}

export type UpgradeError = 'maxed' | 'no-copy' | 'no-money' | 'low-tech'

/**
 * Индекс копии этого модуля в трюме — по тому же `id` (прокачка id не меняет).
 * Ею качают на две ступени разом: копия честнее денег, оттого и сильнее. null — копии нет.
 */
export function upgradeCopyIndex(ship: ShipEntity, module: ShipModule): number | null {
  const i = ship.hold.items.findIndex((it) => it.kind === 'module' && it.module.id === module.id)
  return i >= 0 ? i : null
}

/** Цена денежной ступени — доля цены модуля, одна и та же на любой ступени. С копией денег не берут. */
export function upgradeCashCost(module: ShipModule): number {
  // Сумма по-человечески («1 500», а не «1 517»), как у наград за дела.
  return roundMoney(Math.max(module.cost, SHOP.UPGRADE_MIN_BASE) * SHOP.UPGRADE_CASH_FRACTION)
}


/**
 * Качается ли модуль вообще. Аукс-устройства — нет: каждое работает по-своему, «+5% к ECM»
 * бессмыслен. Космические лучи — нет: бьют миры, а не корабли, урона у них нет («0 → 0»).
 * Одно правило для верфи и для витрины (прокачанные экземпляры в продаже).
 */
export function isUpgradable(module: ShipModule): boolean {
  if (isAux(module)) return false
  return !(module.kind === 'laser' && isCosmic(module.effect))
}

/** Проверка БЕЗ побочных эффектов: ею UI гасит кнопку, ею же `upgradeModule` решает. */
export function canUpgrade(
  world: World,
  ship: ShipEntity,
  module: ShipModule,
  useCopy: boolean,
): UpgradeError | null {
  // Не качается вовсе — гасим как «предельный»: отдельного кода в UI заводить незачем.
  if (!isUpgradable(module)) return 'maxed'
  // Не больше UPGRADE_MAX_STEPS шагов на экземпляр.
  if (upgradeSteps(module) >= SHOP.UPGRADE_MAX_STEPS) return 'maxed'
  // Мир не тянет этот класс — прокачать его здесь негде (тот же потолок, что и у витрины).
  if (!canServiceHere(world, module)) return 'low-tech'
  if (useCopy) return upgradeCopyIndex(ship, module) === null ? 'no-copy' : null
  return world.credits < upgradeCashCost(module) ? 'no-money' : null
}

/**
 * Значение главной характеристики ПОСЛЕ прокачки (копией +10% / деньгами +5%) — для
 * предпросмотра «было → станет» в верфи. Считает ровно тем путём, что и сама прокачка,
 * поэтому число в окне не разойдётся с делом.
 */
export function upgradedStatValue(module: ShipModule, useCopy: boolean): number {
  return moduleStat(withUpgrade(module, nextUpgradeLevel(module, useCopy))).value
}

/** Уровень после следующего шага: ступени СКЛАДЫВАЮТСЯ (деньгами одна, копией две), до потолка. */
export function nextUpgradeLevel(module: ShipModule, useCopy: boolean): number {
  const gain = useCopy ? SHOP.UPGRADE_COPY_STEPS : 1
  return Math.min(SHOP.UPGRADE_MAX_STEPS, upgradeSteps(module) + gain) * SHOP.UPGRADE_STEP
}

/**
 * Прокачать установленный модуль. Клон заменяет ИМЕННО тот экземпляр, что стоит в
 * оснастке (сверяем по ссылке — UI передаёт реальный модуль из loadout). Копия из
 * трюма расходуется; денежная дорога — списывает кредиты. Массу не трогаем: усиление
 * характеристики не должно тайком менять манёвренность, только заявленную ось.
 *
 * Только на верфи — как и вся смена оснастки: правило держит UI, домен исполняет.
 */
export function upgradeModule(
  world: World,
  ship: ShipEntity,
  module: ShipModule,
  useCopy: boolean,
): UpgradeError | null {
  const error = canUpgrade(world, ship, module, useCopy)
  if (error) return error

  // Цена шага — ДО прокачки: она растёт с числом уже сделанных шагов.
  const cashCost = upgradeCashCost(module)
  const upgraded = withUpgrade(module, nextUpgradeLevel(module, useCopy))
  const maxHullBefore = ship.spec.hull.hull

  const wi = ship.loadout.weapons.findIndex((w) => w === module)
  if (wi >= 0) {
    ship.loadout.weapons[wi] = upgraded as WeaponModule
  } else {
    const ii = ship.loadout.internals.indexOf(module)
    if (ii < 0) return 'no-copy' // модуля нет на корабле — звать было неоткуда
    ship.loadout.internals[ii] = upgraded
  }

  if (useCopy) {
    const idx = upgradeCopyIndex(ship, module) // копия ещё в трюме — она и оплата
    if (idx !== null) removeItem(ship.hold, idx)
  } else {
    world.credits -= cashCost
  }

  // Характеристики сменились — пересобираем на СОБЫТИЕ, как и при покупке.
  refreshSpec(ship)
  // Улучшенная броня поднимает потолок корпуса — прирост отдаём СРАЗУ и даром: иначе после
  // прокачки плит корпус выглядел «повреждённым», и мастерская просила деньги за ремонт.
  const gained = ship.spec.hull.hull - maxHullBefore
  if (gained > 0) ship.hull = Math.min(ship.spec.hull.hull, ship.hull + gained)
  return null
}

/** Ось собственной прокачки рамы. Совпадает с ключами `HullUpgrades`. */
// ─── Прокачка СОБСТВЕННЫХ х-к КОРПУСА ─────────────────────────────────────────
//
// Три оси рамы — HP / грузоподъёмность / аукс-ёмкость — каждую можно усилить ОДИН раз
// на +25% (как модуль: разово, без уровней). Что усилено, живёт на сущности (`hullUp`);
// х-ки выводит `deriveShipSpec`. Усиленная ось поднимает и СТОИМОСТЬ рамы при зачёте.

export type HullStat = 'hull' | 'cargo' | 'aux'

/**
 * Что продаёт мастерская рамы. Только ПРОЧНОСТЬ: отсек и аукс растят модули (контейнеры,
 * батареи), и три кнопки «укрепить» рядом с ними читались загадкой. Купленные прежде усиления
 * отсека и аукса (`hullUp`) по-прежнему действуют — их просто больше не продают.
 */
export const HULL_STATS: readonly HullStat[] = ['hull']

export type HullUpgradeError = 'no-money' | 'already'

/** Цена прокачки одной оси рамы — доля цены корпуса. Одна на все оси: рама одна. */
export function hullStatUpgradeCost(ship: ShipEntity): number {
  return Math.ceil(SHOP.HULL_STAT_COST_FRACTION * ship.loadout.chassis.cost)
}

/** Проверка без побочных эффектов: уже усилена — 'already', не хватает денег — 'no-money'. */
export function canUpgradeHullStat(world: World, ship: ShipEntity, stat: HullStat): HullUpgradeError | null {
  // Флаги чужой рамы не считаются: иначе после покупки нового корпуса кнопка гасла галкой.
  if (hullUpFor(ship.hullUp, ship.loadout.chassis.id)[stat]) return 'already'
  return world.credits < hullStatUpgradeCost(ship) ? 'no-money' : null
}

/**
 * Усилить одну ось рамы на +25% — РАЗОВО (второй раз → 'already'). Прирост потолка HP и
 * аукс-заряда отдаём СРАЗУ: усиленная рама уже на борту, а не «оплачена, но пуста».
 */
export function upgradeHullStat(world: World, ship: ShipEntity, stat: HullStat): HullUpgradeError | null {
  const error = canUpgradeHullStat(world, ship, stat)
  if (error) return error

  world.credits -= hullStatUpgradeCost(ship)
  const beforeHull = ship.spec.hull.hull
  const beforeAux = ship.spec.power.auxCapacity
  const id = ship.loadout.chassis.id
  // Чужие флаги выкидываем: иначе `hullUp[stat] = true` оставило бы +25% от старой рамы.
  ship.hullUp = { ...factoryHullUp(id), ...hullUpFor(ship.hullUp, id), chassis: id, [stat]: true }
  refreshSpec(ship)
  ship.hull += ship.spec.hull.hull - beforeHull
  ship.auxEnergy += ship.spec.power.auxCapacity - beforeAux
  return null
}
