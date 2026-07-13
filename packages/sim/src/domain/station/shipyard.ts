import { SHOP } from '../../config/station'
import { clamp } from '../../core/math'
import { addItem, usedCapacityOf } from '../cargo/hold'
import {
  createLoadout,
  deriveShipSpec,
  slotCategoryOf,
  type Chassis,
  type Loadout,
  type ShipModule,
  type WeaponModule,
} from '../loadout'
import { refreshSpec } from '../world'
import type { ShipEntity, World } from '../world/entities'
import { localSettlement, masterClass, type MasterClass } from './shop'

/**
 * Верфь: смена КОРПУСА, а не отдельного модуля.
 *
 * Правило живёт в домене, как и всё остальное: где нажали кнопку — не его забота.
 * Однажды то же самое исполнит сервер, ничего не правя.
 *
 * Корпус меняют вместе с ОБВЕСОМ: своё железо переезжает на новую раму. Что в её
 * слоты не влезло (у компактного корпуса их меньше) — уходит в трюм грузом. А если
 * и трюма не хватает на всё перенесённое — смена не состоится: сперва продай лишнее.
 */

export type HullError = 'not-docked' | 'no-money' | 'no-room'

/** Результат примерки обвеса на корпус: что встало в слоты и что осталось «на руках». */
export interface HullFit {
  loadout: Loadout
  /** Модули, которым в новом корпусе места нет: их предстоит везти в трюме. */
  overflow: ShipModule[]
}

/**
 * Разложить текущий обвес по слотам целевого корпуса. Жадно, по виду и классу: слот
 * берёт первый подходящий модуль. Что не разошлось по слотам и точкам подвески —
 * `overflow`: у нового корпуса их могло оказаться меньше, чем железа на старом.
 */
export function fitOntoChassis(current: Loadout, chassis: Chassis): HullFit {
  const pool = [...current.internals]
  const fitted: ShipModule[] = []
  for (const slot of chassis.slots) {
    // По КАТЕГОРИИ (аукс делят разные виды) и по классу корпуса, не слота.
    const idx = pool.findIndex((m) => slotCategoryOf(m.kind) === slot.kind && m.class <= chassis.class)
    if (idx >= 0) fitted.push(pool.splice(idx, 1)[0]!)
  }

  // Оружие — по точкам подвески: орудийная точка несёт лазер, пилон — ракету ИЛИ
  // контейнер БПЛА (он тоже подвесной). Класс модуля не крупнее того, что точка тянет.
  const guns = current.weapons.filter((w): w is WeaponModule => w != null)
  const weapons: (WeaponModule | null)[] = chassis.hardpoints.map(() => null)
  chassis.hardpoints.forEach((hp, i) => {
    const accepts = (k: WeaponModule['kind']) => (hp.kind === 'pylon' ? k === 'missile' || k === 'drone' : k === 'laser')
    const idx = guns.findIndex((w) => accepts(w.kind) && w.class <= chassis.class)
    if (idx >= 0) weapons[i] = guns.splice(idx, 1)[0]!
  })

  return { loadout: createLoadout(chassis, fitted, weapons), overflow: [...pool, ...guns] }
}

/** Доля уцелевшего корпуса, 0..1 — «поломка» рамы, которую верфь видит при зачёте. */
export function hullCondition(ship: ShipEntity): number {
  const max = ship.spec.hull.hull
  return max > 0 ? clamp(ship.hull / max, 0, 1) : 0
}

/**
 * За сколько верфь ЗДЕСЬ примет старый корпус в зачёт при покупке нового. Цена-с-поломкой
 * (цена рамы × доля уцелевшего HP) урезается классом мастерской: плохой сервис недоплачивает
 * (SHOP.TRADE_IN_BY_CLASS: класс 1 — половина, 2 — три четверти, 3 — по полной). Вложенное
 * в апгрейды рамы не возвращают — берём каталожную цену шасси, не с учётом уровня.
 */
export function hullTradeIn(world: World, ship: ShipEntity): number {
  const master = masterClass(localSettlement(world))
  const withFault = ship.loadout.chassis.cost * hullCondition(ship)
  return Math.round(withFault * SHOP.TRADE_IN_BY_CLASS[master])
}

/** Полный расклад покупки корпуса — всё для модалки подтверждения, без мутаций мира. */
export interface HullPurchase {
  chassis: Chassis
  /** Каталожная цена новой рамы. */
  price: number
  /** Зачёт старого корпуса здесь. */
  tradeIn: number
  /** Доплата: `price − tradeIn`. Меньше нуля — верфь доплатит (даунгрейд). */
  net: number
  master: MasterClass
  oldChassis: Chassis
  /** Доля уцелевшего HP старого корпуса, 0..1 — показать поломку при зачёте. */
  oldCondition: number
  /** Обвес, которому в новой раме места в слотах нет: уедет в грузовой отсек. */
  overflow: ShipModule[]
  /** Грузоподъёмность новой рамы, т. */
  newCapacity: number
  /** Сколько тонн придётся везти в новой раме: текущий груз + перенесённый обвес. */
  loadAfter: number
  /** Влезает ли это в новую раму. false — покупка не состоится, сперва продай лишнее. */
  fits: boolean
}

/**
 * Расклад покупки корпуса ЗДЕСЬ: цена, зачёт старого, доплата, что не влезет в слоты (уедет
 * в грузовой отсек) и хватит ли на всё это грузоподъёмности. Ничего не мутирует — это витрина
 * для модалки; саму сделку исполняет `swapHull` с той же `net`.
 */
export function hullPurchase(world: World, chassis: Chassis): HullPurchase {
  const player = world.player
  const { loadout, overflow } = fitOntoChassis(player.loadout, chassis)
  const newCapacity = deriveShipSpec(loadout).cargoCapacity
  const overflowMass = overflow.reduce((m, x) => m + x.mass, 0)
  const loadAfter = usedCapacityOf(player.hold) + overflowMass
  const price = chassis.cost
  const tradeIn = hullTradeIn(world, player)
  return {
    chassis,
    price,
    tradeIn,
    net: price - tradeIn,
    master: masterClass(localSettlement(world)),
    oldChassis: player.loadout.chassis,
    oldCondition: hullCondition(player),
    overflow,
    newCapacity,
    loadAfter,
    fits: loadAfter <= newCapacity,
  }
}

/**
 * Сменить корпус, перенеся обвес. `no-room` — трюма нового корпуса не хватает на
 * текущий груз плюс всё, что не влезло в слоты: интерфейс попросит сперва продать лишнее.
 * Свежая рама заправлена под завязку (корпус, щит, заряд привода): купил — и в путь.
 */
export function swapHull(world: World, chassis: Chassis, cost: number): HullError | null {
  if (!world.docked) return 'not-docked'
  if (world.credits < cost) return 'no-money'

  const player = world.player
  const { loadout, overflow } = fitOntoChassis(player.loadout, chassis)

  // Грузоподъёмность НОВОГО корпуса против того, что придётся в нём везти: уже лежащий
  // груз плюс перенесённый в трюм обвес. Не влезло — смену отклоняем целиком, мир не тронут.
  const capacity = deriveShipSpec(loadout).cargoCapacity
  const overflowMass = overflow.reduce((m, x) => m + x.mass, 0)
  if (usedCapacityOf(player.hold) + overflowMass > capacity) return 'no-room'

  world.credits -= cost
  player.loadout = loadout
  // Новый корпус — заводского уровня: апгрейд копится на КОНКРЕТНОЙ раме, не переезжает.
  player.hullLevel = 0
  refreshSpec(player) // пересчитает и вместимость трюма — под неё и кладём overflow
  for (const module of overflow) addItem(player.hold, { kind: 'module', module })
  player.hull = player.spec.hull.hull
  player.shield = player.spec.hull.shield
  player.jumpCharge = player.spec.jumpRange
  return null
}
