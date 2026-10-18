import { SHOP } from '../../config/station'
import { SHIPYARD, type HullOffer } from '../../config/loadouts'
import { clamp } from '../../core/math'
import { addItem, usedCapacityOf } from '../cargo/hold'
import {
  createLoadout,
  deriveShipSpec,
  NO_HULL_UPGRADES,
  slotCategoryOf,
  type Chassis,
  type HullUpgrades,
  type Loadout,
  type ShipModule,
  type WeaponModule,
} from '../loadout'
import { refreshSpec } from '../world'
import type { ShipEntity, World } from '../world/entities'
import { masterClass, type MasterClass } from './repair'
import { moduleResaleValue } from './shop'
import { localSettlement } from './trade'

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

export type HullError = 'not-docked' | 'not-sold' | 'no-money' | 'no-room'

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
  // Контейнеры — от самого вместительного: грузовых слотов у новой рамы может быть меньше,
  // и в слот обязан встать тот, что даёт трюму больше, а не первый попавшийся. Прочее — в
  // прежнем порядке (сортировка устойчивая, у не-контейнеров ключ один — ноль).
  const pool = [...current.internals].sort((a, b) => rackCapacity(b) - rackCapacity(a))
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

/**
 * Примерка своего обвеса НА заводскую сборку, а не вместо неё.
 *
 * `fitOntoChassis` переносит только своё железо: штатные стволы, щит и контейнер
 * витрины пропадают, и корпус на глаз слабее того, что только что показывали.
 * Здесь заводское остаётся в своих слотах, своё встаёт в свободные. Чему места
 * нет — в примерку не входит (покупка по-прежнему перевозит только свой обвес).
 */
export function stackWithFactory(player: Loadout, factory: Loadout): Loadout {
  const chassis = factory.chassis
  const pool = [...player.internals].sort((a, b) => rackCapacity(b) - rackCapacity(a))
  const stock = [...factory.internals]
  const fitted: ShipModule[] = []
  for (const slot of chassis.slots) {
    const fromStock = stock.findIndex((m) => slotCategoryOf(m.kind) === slot.kind && m.class <= chassis.class)
    if (fromStock >= 0) {
      fitted.push(stock.splice(fromStock, 1)[0]!)
      continue
    }
    const fromPlayer = pool.findIndex((m) => slotCategoryOf(m.kind) === slot.kind && m.class <= chassis.class)
    if (fromPlayer >= 0) fitted.push(pool.splice(fromPlayer, 1)[0]!)
  }

  const guns = player.weapons.filter((w): w is WeaponModule => w != null)
  const weapons: (WeaponModule | null)[] = chassis.hardpoints.map((_, i) => factory.weapons[i] ?? null)
  chassis.hardpoints.forEach((hp, i) => {
    if (weapons[i]) return
    const accepts = (k: WeaponModule['kind']) => (hp.kind === 'pylon' ? k === 'missile' || k === 'drone' : k === 'laser')
    const idx = guns.findIndex((w) => accepts(w.kind) && w.class <= chassis.class)
    if (idx >= 0) weapons[i] = guns.splice(idx, 1)[0]!
  })

  return createLoadout(chassis, fitted, weapons)
}

function rackCapacity(m: ShipModule): number {
  return m.kind === 'cargo' ? m.capacity : 0
}

/**
 * Корпуса на верфи ЭТОЙ станции: общий ряд плюс то, что продают лишь при здешнем правлении
 * (`HullOffer.soldBy` — «Гермес» у диктатур). Свой корпус в списке есть всегда: на нём стоишь.
 */
export function shipyardOffers(world: World): readonly HullOffer[] {
  const government = localSettlement(world).government
  const own = world.player.loadout.chassis.id
  return SHIPYARD.filter((o) => !o.soldBy || o.soldBy.includes(government) || o.chassis.id === own)
}

/** Доля уцелевшего корпуса, 0..1 — «поломка» рамы, которую верфь видит при зачёте. */
export function hullCondition(ship: ShipEntity): number {
  const max = ship.spec.hull.hull
  return max > 0 ? clamp(ship.hull / max, 0, 1) : 0
}

/**
 * Стоимость рамы С УЧЁТОМ прокачек: каталожная цена шасси плюс надбавка за каждую усиленную
 * ось (на `HULL_STAT_VALUE_FRACTION`). Прокачал — рама объективно лучше и стоит дороже, и это
 * видно в зачёте/продаже. Меньше, чем стоил апгрейд: часть вложенного всё же теряется.
 */
export function hullValue(chassis: Chassis, up: HullUpgrades): number {
  const upgraded = (up.hull ? 1 : 0) + (up.cargo ? 1 : 0) + (up.aux ? 1 : 0)
  return Math.round(chassis.cost * (1 + upgraded * SHOP.HULL_STAT_VALUE_FRACTION))
}

/**
 * За сколько верфь ЗДЕСЬ примет старый корпус в зачёт при покупке нового. Стоимость рамы с
 * прокачками (`hullValue`) × доля уцелевшего HP, урезанная классом мастерской: плохой сервис
 * недоплачивает (SHOP.TRADE_IN_BY_CLASS: класс 1 — половина, 2 — три четверти, 3 — по полной).
 */
export function hullTradeIn(world: World, ship: ShipEntity): number {
  const master = masterClass(localSettlement(world))
  const withFault = hullValue(ship.loadout.chassis, ship.hullUp) * hullCondition(ship)
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
  /** Обвес, которому в новой раме места в слотах нет: уедет в грузовой отсек (или продан). */
  overflow: ShipModule[]
  /** Выкупная цена этого обвеса здесь — столько даст верфь, если продать его в сделке. */
  overflowValue: number
  /** Продаётся ли не вставшее в сделке (тогда оно не едет в трюм, а идёт в зачёт). */
  sellOverflow: boolean
  /** Грузоподъёмность новой рамы, т, и из чего она сложена. */
  newCapacity: number
  newBudget: { chassis: number; racks: number; equipment: number }
  /** Груз, что уже в трюме, т. */
  cargoLoad: number
  /** Масса не вставшего обвеса, т (в трюм — если не продаётся). */
  overflowMass: number
  /** Сколько тонн придётся везти в новой раме: груз + не вставший обвес (если не продан). */
  loadAfter: number
  /** Влезает ли это в новую раму. false — покупка не состоится, сперва продай лишнее. */
  fits: boolean
}

/**
 * Расклад покупки корпуса ЗДЕСЬ: цена, зачёт старого, доплата, что не влезет в слоты (уедет
 * в грузовой отсек) и хватит ли на всё это грузоподъёмности. Ничего не мутирует — это витрина
 * для модалки; саму сделку исполняет `swapHull` с той же `net`.
 */
export function hullPurchase(world: World, chassis: Chassis, sellOverflow = false): HullPurchase {
  const player = world.player
  const { loadout, overflow } = fitOntoChassis(player.loadout, chassis)
  const spec = deriveShipSpec(loadout)
  const newCapacity = spec.cargoCapacity
  const overflowMass = overflow.reduce((m, x) => m + x.mass, 0)
  const overflowValue = overflow.reduce((v, x) => v + moduleResaleValue(player, x), 0)
  const cargoLoad = usedCapacityOf(player.hold)
  // Проданное в сделке в трюм не едет — оно уходит верфи и идёт в зачёт.
  const loadAfter = cargoLoad + (sellOverflow ? 0 : overflowMass)
  const price = chassis.cost
  const tradeIn = hullTradeIn(world, player)
  return {
    chassis,
    price,
    tradeIn,
    net: price - tradeIn - (sellOverflow ? overflowValue : 0),
    overflowValue,
    sellOverflow,
    newBudget: spec.cargoBudget,
    cargoLoad,
    overflowMass,
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
export function swapHull(world: World, chassis: Chassis, cost: number, sellOverflow = false): HullError | null {
  if (!world.docked) return 'not-docked'
  // Корпус не из ряда этой верфи (военный у не-диктатуры) — сделки нет, кто бы ни просил.
  if (!shipyardOffers(world).some((o) => o.chassis.id === chassis.id)) return 'not-sold'
  if (world.credits < cost) return 'no-money'

  const player = world.player
  const { loadout, overflow } = fitOntoChassis(player.loadout, chassis)

  // Грузоподъёмность НОВОГО корпуса против того, что придётся в нём везти: уже лежащий
  // груз плюс перенесённый в трюм обвес (если его не продают в сделке). Не влезло — смену
  // отклоняем целиком, мир не тронут.
  const capacity = deriveShipSpec(loadout).cargoCapacity
  const overflowMass = sellOverflow ? 0 : overflow.reduce((m, x) => m + x.mass, 0)
  if (usedCapacityOf(player.hold) + overflowMass > capacity) return 'no-room'

  world.credits -= cost
  player.loadout = loadout
  // Новый корпус — заводской: прокачки копятся на КОНКРЕТНОЙ раме и не переезжают.
  player.hullUp = { ...NO_HULL_UPGRADES }
  refreshSpec(player) // пересчитает и вместимость трюма — под неё и кладём overflow
  // Не вставшее — в трюм, либо продано верфи: его цена уже в `cost` (см. `hullPurchase`).
  if (!sellOverflow) for (const module of overflow) addItem(player.hold, { kind: 'module', module })
  player.hull = player.spec.hull.hull
  player.shield = player.spec.hull.shield
  player.jumpCharge = player.spec.jumpRange
  return null
}
