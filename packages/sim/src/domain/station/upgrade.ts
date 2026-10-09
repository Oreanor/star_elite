import { SHOP } from '../../config/station'
import { removeItem } from '../cargo/hold'
import {
  isAux,
  type ShipModule,
  type WeaponModule,
} from '../loadout'
import type { ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'
import { canServiceHere, moduleStat, upgradeLevel, withUpgrade } from './moduleState'

/**
 * Прокачка: модуля (копией из трюма или деньгами) и собственных характеристик корпуса.
 * Однократная — второй раз тот же модуль не растёт.
 */

export type UpgradeError = 'maxed' | 'no-copy' | 'no-money' | 'low-tech'

/**
 * Индекс копии этого модуля в трюме — по тому же `id` (прокачка id не меняет).
 * Ею и качают на +50%: копия честнее денег, оттого и сильнее. null — копии нет.
 */
export function upgradeCopyIndex(ship: ShipEntity, module: ShipModule): number | null {
  const i = ship.hold.items.findIndex((it) => it.kind === 'module' && it.module.id === module.id)
  return i >= 0 ? i : null
}

/** Цена ОДНОГО денежного шага прокачки. С копией денег не берут — платит трюм. */
export function upgradeCashCost(module: ShipModule): number {
  return Math.ceil(Math.max(module.cost, SHOP.UPGRADE_MIN_BASE) * SHOP.UPGRADE_CASH_FRACTION)
}

/** Проверка БЕЗ побочных эффектов: ею UI гасит кнопку, ею же `upgradeModule` решает. */
export function canUpgrade(
  world: World,
  ship: ShipEntity,
  module: ShipModule,
  useCopy: boolean,
): UpgradeError | null {
  // Аукс-устройства не прокачиваются: каждое работает по-своему, «+25% к ECM» бессмыслен.
  // Гасим как «предельный» — отдельного кода в UI заводить незачем.
  if (isAux(module)) return 'maxed'
  // Каждый модуль улучшается один раз: уже прокачанный дальше не берут.
  if (upgradeLevel(module) > 1e-6) return 'maxed'
  // Мир не тянет этот класс — прокачать его здесь негде (тот же потолок, что и у витрины).
  if (!canServiceHere(world, module)) return 'low-tech'
  if (useCopy) return upgradeCopyIndex(ship, module) === null ? 'no-copy' : null
  return world.credits < upgradeCashCost(module) ? 'no-money' : null
}

/**
 * Значение главной характеристики ПОСЛЕ прокачки (копией +50% / деньгами +25%) — для
 * предпросмотра «было → станет» в верфи. Считает ровно тем путём, что и сама прокачка,
 * поэтому число в окне не разойдётся с делом.
 */
export function upgradedStatValue(module: ShipModule, useCopy: boolean): number {
  const level = useCopy ? SHOP.UPGRADE_COPY_STEP : SHOP.UPGRADE_CASH_STEP
  return moduleStat(withUpgrade(module, level)).value
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

  // Однократно: до сюда доходит только сток (canUpgrade отсекает уже прокачанный).
  const level = useCopy ? SHOP.UPGRADE_COPY_STEP : SHOP.UPGRADE_CASH_STEP
  const upgraded = withUpgrade(module, level)

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
    world.credits -= upgradeCashCost(module)
  }

  // Характеристики сменились — пересобираем на СОБЫТИЕ, как и при покупке.
  refreshSpec(ship)
  return null
}

/** Ось собственной прокачки рамы. Совпадает с ключами `HullUpgrades`. */
// ─── Прокачка СОБСТВЕННЫХ х-к КОРПУСА ─────────────────────────────────────────
//
// Три оси рамы — HP / грузоподъёмность / аукс-ёмкость — каждую можно усилить ОДИН раз
// на +25% (как модуль: разово, без уровней). Что усилено, живёт на сущности (`hullUp`);
// х-ки выводит `deriveShipSpec`. Усиленная ось поднимает и СТОИМОСТЬ рамы при зачёте.

export type HullStat = 'hull' | 'cargo' | 'aux'

export const HULL_STATS: readonly HullStat[] = ['hull', 'cargo', 'aux']

export type HullUpgradeError = 'no-money' | 'already'

/** Цена прокачки одной оси рамы — доля цены корпуса. Одна на все оси: рама одна. */
export function hullStatUpgradeCost(ship: ShipEntity): number {
  return Math.ceil(SHOP.HULL_STAT_COST_FRACTION * ship.loadout.chassis.cost)
}

/** Проверка без побочных эффектов: уже усилена — 'already', не хватает денег — 'no-money'. */
export function canUpgradeHullStat(world: World, ship: ShipEntity, stat: HullStat): HullUpgradeError | null {
  if (ship.hullUp[stat]) return 'already'
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
  ship.hullUp[stat] = true
  refreshSpec(ship)
  ship.hull += ship.spec.hull.hull - beforeHull
  ship.auxEnergy += ship.spec.power.auxCapacity - beforeAux
  return null
}
