import { SHOP } from '../../config/station'
import { roundMoney } from '../../core/math'
import { cargoMass, removeItem } from '../cargo/hold'
import {
  deriveShipSpec,
  isAux,
  type ShipModule,
  type WeaponModule,
} from '../loadout'
import type { ShipEntity, World } from '../world/entities'
import { refreshSpec } from '../world/factory'
import { canServiceHere, moduleStat, upgradeLevel, withUpgrade } from './moduleState'

/**
 * Прокачка: модуля (копией из трюма или деньгами) и собственных характеристик корпуса.
 * Модуль улучшают до `SHOP.UPGRADE_MAX_STEPS` раз, шаги складываются.
 */

/** Сколько раз модуль уже улучшали. Старые сейвы без счётчика: прокачан — значит один раз. */
export function upgradeSteps(module: ShipModule): number {
  return module.upgrades ?? (upgradeLevel(module) > 1e-6 ? 1 : 0)
}

export type UpgradeError = 'maxed' | 'no-copy' | 'no-money' | 'low-tech'

/**
 * Индекс копии этого модуля в трюме — по тому же `id` (прокачка id не меняет).
 * Ею и качают на +50%: копия честнее денег, оттого и сильнее. null — копии нет.
 */
export function upgradeCopyIndex(ship: ShipEntity, module: ShipModule): number | null {
  const i = ship.hold.items.findIndex((it) => it.kind === 'module' && it.module.id === module.id)
  return i >= 0 ? i : null
}

/**
 * Цена СЛЕДУЮЩЕГО денежного шага прокачки: каждый следующий дороже предыдущего (×1, ×2, ×3
 * доли цены модуля) — последний процент силы стоит дороже первого. С копией денег не берут.
 */
export function upgradeCashCost(module: ShipModule): number {
  const base = Math.max(module.cost, SHOP.UPGRADE_MIN_BASE) * SHOP.UPGRADE_CASH_FRACTION
  // Сумма по-человечески («10 000», а не «10 133»), как у наград за дела.
  return roundMoney(base * (upgradeSteps(module) + 1))
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
  // Не больше UPGRADE_MAX_STEPS шагов на экземпляр.
  if (upgradeSteps(module) >= SHOP.UPGRADE_MAX_STEPS) return 'maxed'
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
  return moduleStat(withUpgrade(module, nextLevel(module, useCopy))).value
}

/** Уровень после следующего шага: шаги СКЛАДЫВАЮТСЯ (+25% деньгами, +50% копией). */
function nextLevel(module: ShipModule, useCopy: boolean): number {
  return upgradeLevel(module) + (useCopy ? SHOP.UPGRADE_COPY_STEP : SHOP.UPGRADE_CASH_STEP)
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
  const upgraded = withUpgrade(module, nextLevel(module, useCopy))
  upgraded.upgrades = upgradeSteps(module) + 1
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

/**
 * Что даст усиление оси: значение сейчас и после, в единицах характеристики (HP, т, ед.).
 * Считается тем же `deriveShipSpec`, что и сам корабль, — кнопка не обещает чужих чисел.
 */
export function hullStatPreview(ship: ShipEntity, stat: HullStat): { from: number; to: number } {
  const pick = (spec: ReturnType<typeof deriveShipSpec>) =>
    stat === 'hull' ? spec.hull.hull : stat === 'cargo' ? spec.cargoCapacity : spec.power.auxCapacity
  const mass = cargoMass(ship.hold)
  const from = pick(deriveShipSpec(ship.loadout, mass, ship.hullUp))
  const to = pick(deriveShipSpec(ship.loadout, mass, { ...ship.hullUp, [stat]: true }))
  return { from, to }
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
